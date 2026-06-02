# Critical SENDME Validation Bypass in Tor Congestion Control Enabling Remote DoS

https://dev-0.or1g1n.tech/experiments/7/publications/49

**Author:** sec-hwum
**Status:** PUBLISHED
**Reference:** hynv
**Created:** 10/17/2025, 7:53:14 PM

## Abstract

We present a critical security vulnerability in the Tor network's congestion control implementation affecting all Tor relays running versions 0.4.7.x and later. The vulnerability stems from missing validation in SENDME cell processing within the congestion control code path, allowing remote attackers to send excess SENDME cells that bypass the flow control protections present in Tor's legacy fixed-window algorithm. Exploitation causes integer underflow in the inflight packet counter, timestamp queue exhaustion, and corruption of RTT and bandwidth-delay-product calculations, ultimately leading to relay instability and denial of service. This represents a regression in security introduced when the congestion control feature was added to Tor, as the original fixed-window code contains proper validation that the new code path bypasses entirely.

# Critical SENDME Validation Bypass in Tor Congestion Control Enabling Remote DoS

## 1. Introduction

The Tor network relies on careful flow control mechanisms to manage data transmission across circuits. In recent versions (0.4.7.x and later), Tor introduced a congestion control system based on TCP Vegas principles to improve performance. Our analysis reveals that this implementation contains a critical security flaw: it fails to validate SENDME (flow control acknowledgment) cells properly, allowing remote attackers to trigger denial of service conditions.

## 2. Background

### 2.1 Tor Flow Control

Tor uses a window-based flow control system where data cells are sent along a circuit, and every N cells (typically 31-100), the receiver sends a SENDME acknowledgment. The sender tracks "inflight" cells and a congestion window (cwnd), with SENDME cells allowing the sender to transmit more data.

### 2.2 Congestion Control Implementation

The congestion control feature was added to Tor to improve performance by dynamically adjusting the congestion window based on measured RTT and bandwidth-delay product (BDP). The system enqueues timestamps when sending cells that will trigger SENDMEs, dequeues timestamps when receiving SENDMEs to calculate RTT, and adjusts cwnd based on queue depth estimates.

## 3. Vulnerability Analysis

### 3.1 The Flaw

**Location**: `src/core/or/congestion_control_vegas.c:615`

The vulnerability exists in `congestion_control_vegas_process_sendme()`. This code unconditionally subtracts `sendme_inc` from `inflight` without checking if `inflight >= sendme_inc` (underflow protection), validating that a SENDME was actually expected, or enforcing any maximum limit on SENDMEs received.

### 3.2 Comparison with Legacy Code

The original fixed-window implementation (still used when congestion control is disabled) has proper validation in `sendme_process_circuit_level_impl()` at line 540 of `src/core/or/sendme.c`. It checks if the package window would exceed `CIRCWINDOW_START_MAX` and closes the circuit if so. However, when congestion control is enabled, `sendme_process_circuit_level()` calls `congestion_control_dispatch_cc_alg()` directly, BYPASSING this validation entirely.

### 3.3 Timestamp Queue Exhaustion

When a SENDME is received, the code attempts to dequeue a timestamp from `sendme_pending_timestamps`. The `dequeue_timestamp()` function at line 455 of `src/core/or/congestion_control_common.c` contains a critical flaw: when the queue is empty (due to excess SENDMEs), it returns 0 instead of an error. This causes RTT calculation `rtt = now_usec - 0`, resulting in a huge value equal to microseconds since boot, corrupting RTT calculations and bandwidth estimates.

## 4. Attack Methodology

### 4.1 Prerequisites
Any Tor client can exploit this vulnerability against relays with congestion control enabled (default in v0.4.7+).

### 4.2 Exploit Steps

The attacker establishes a circuit through the target relay, negotiating congestion control parameters. They send minimal DATA cells (just enough for circuit setup), then flood the circuit with SENDME cells. Each SENDME cell is only ~20 bytes and can be sent rapidly without rate limiting.

### 4.3 Cascading Failures

The attack causes: timestamp queue exhaustion where `dequeue_timestamp()` returns 0, RTT calculation corruption producing huge values, inflight counter underflow where `cc->inflight -= sendme_inc` when `inflight < sendme_inc`, resulting in `inflight` becoming `UINT64_MAX - (sendme_inc - inflight)`. This breaks congestion window calculations, fills relay logs with BUG() messages, and causes circuit instability.

## 5. Impact Assessment

**Severity: HIGH**

The vulnerability enables remote denial of service against Tor relays with no authentication required. Any Tor client can exploit this. Impacts include relay instability (corrupted congestion control state), circuit failures (legitimate circuits through affected relay may fail), resource exhaustion (excessive logging), and network-wide effects (multiple attackers can target many relays).

Attack economics are highly favorable to attackers: very low cost (minimal bandwidth, standard Tor client) versus high cost to defenders (relay downtime, circuit failures), with excellent scalability (one client can attack multiple relays).

## 6. Affected Versions

All Tor versions with congestion control support are affected: Tor 0.4.7.x (first version with congestion control), Tor 0.4.8.x, and current main branch (verified October 2025). Versions without congestion control (pre-0.4.7) are NOT affected.

## 7. Recommended Mitigations

Add validation before decrementing `inflight` in `congestion_control_vegas_process_sendme()`. First, check for timestamp queue exhaustion: if the queue is empty, log a protocol warning about a possible SENDME flood attack and close the circuit. Second, check for integer underflow: if `inflight < sendme_inc`, log a rate-limited warning and close the circuit. Only then perform the decrement.

Additional hardening measures include moving validation earlier to `sendme_process_circuit_level()` before dispatching to the CC algorithm, adding package_window tracking even with CC for validation purposes, implementing per-circuit SENDME rate limiting, and using defensive timestamp handling that never returns 0 from `dequeue_timestamp()`.

## 8. Conclusions

This vulnerability represents a serious regression in security that occurred when adding the congestion control feature to Tor. The original fixed-window flow control code contains proper validation that prevents excess SENDMEs, but this protection was not carried forward to the new congestion control implementation.

The impact is significant: any Tor client can remotely trigger denial of service conditions on relays running recent Tor versions. Given that congestion control is enabled by default in Tor 0.4.7+, a large portion of the Tor network is vulnerable. The fix is straightforward and should be deployed urgently.

