# Vulnerability Assessment Results

---

## 8i5d — Use-After-Free in Tor Circuit Padding Subsystem

**Vulnerability status: not reproducible**

**Claimed:** `circpad_circuit_machineinfo_free_idx()` frees `circ->padding_info[idx]` but does not set it to `NULL`, leaving a dangling pointer that later passes the `FOR_EACH_ACTIVE_CIRCUIT_MACHINE_BEGIN` non-NULL check.

**Code finding:** In `src/lib/malloc/malloc.h`, `tor_free(p)` is a macro that **both frees and NULLs its argument**:

```c
#define tor_free(p) STMT_BEGIN                         \
    ...                                                \
    raw_free(*tor_free__tmpvar);                       \
    *tor_free__tmpvar = NULL;                          \
  STMT_END
```

Therefore `tor_free(circ->padding_info[idx])` in `circpad_circuit_machineinfo_free_idx()` sets `circ->padding_info[idx] = NULL` as a side-effect. The `FOR_EACH_ACTIVE_CIRCUIT_MACHINE_BEGIN` macro's guard (`if (!(circ)->padding_info[loop_var]) continue;`) then correctly skips the freed slot.

**Why it does not work as reported:** The report incorrectly assumes `tor_free` only frees memory. This is the central, factual error. No dangling pointer is created.

---

## 9qtg — Memory Corruption in Tor Descriptor Parsing via Malformed Router Descriptors

**Vulnerability status: not reproducible**

**Claimed:** `router_parse_entry_from_string()` in `src/feature/dirparse/routerparse.c` does not validate input length, enabling memory corruption or DoS via malformed descriptors.

**Code finding:** The claim is entirely vague. The function uses a `memarea_t`-based tokenizer with an explicit `end` pointer derived from `maxlen`. There is no heap buffer that can be overrun by input length alone. The report provides no concrete code path leading to memory corruption — only the observation that `end = s + strlen(s)` is used, which is a normal pattern safe from overflow in its context. The report has **REJECTED** status from the author's own platform.

**Why it does not work as reported:** No exploitable code path is identified. The speculation about "buffer overflows or memory exhaustion" is unsubstantiated.

---

## dwi0 — Tor HS Remote DoS via Unbounded Length Fields in INTRODUCE Cell Parsing

**Vulnerability status: not reproducible**

**Claimed:** TRUNNEL-generated parsers for INTRODUCE/INTRODUCE1 cells allow `auth_key_len` (u16, up to 65535) and `onion_key_len` to force large allocations — 400:1 memory amplification from a 500-byte cell.

**Code finding:** TRUNNEL uses `CHECK_REMAINING(obj->auth_key_len, truncated)` **before** the `TRUNNEL_DYNARRAY_EXPAND`. This macro verifies that `remaining >= auth_key_len` bytes are actually present in the input buffer. If not, the parser returns `-2` (truncated) without allocating anything. A 498-byte relay cell payload simply cannot carry 60,000 bytes of auth key data: the `CHECK_REMAINING` call fails immediately, no allocation occurs. The report has **REJECTED** status from the author's own platform.

**Why it does not work as reported:** TRUNNEL parsers are data-driven — they only allocate what the input actually contains. Claiming 60KB of allocation from a 498-byte cell contradicts how `CHECK_REMAINING` works.

---

## fs1y — Critical Use-After-Free in Tor Cell Processing: DESTROY-RELAY Race

**Vulnerability status: not reproducible**

**Claimed:** A DESTROY then RELAY cell race causes use-after-free. Sending a DESTROY cell marks a circuit for close; a milliseconds-later RELAY cell on the same circuit ID then accesses freed edge connections.

**Code finding:** Tor is a **single-threaded event-loop** process. DESTROY and RELAY cells on the same connection are processed sequentially in the same event-loop iteration. There is no OS-level thread concurrency between the "destroy worker" and "relay worker" the PoC spawns: those threads both write to a socket and the kernel serializes the writes, but Tor reads and processes them one at a time inside a single `[event callback → cell dispatch]` call chain. After `circuit_mark_for_close`, the circuit remains in the circuit map (`marked_for_close != 0`) but is not freed until the end of the main loop, and `circuit_receive_relay_cell` checks `circ->marked_for_close` at appropriate internal points. The concurrent-thread PoC model does not apply to a single-threaded reactor.

**Why it does not work as reported:** The claimed "race window of 10–100 microseconds" requires simultaneous multi-threaded execution, which does not exist in Tor's cell processing architecture.

---

## he6m — Race Condition in Tor OR Connection Handling

**Vulnerability status: not reproducible**

**Claimed:** `connection_or_close_normally()` has a race between closing an OR connection and concurrent use by a CPU worker or other thread.

**Code finding:** Tor's main network loop (including OR connection management) runs in a single thread. The "CPU workers" used for cryptographic operations communicate via a work-queue abstraction and do not directly access `or_connection_t` or `channel_t` from a second thread while the main loop is operating on them. There is no unsynchronized concurrent access to the connection from multiple threads.

**Why it does not work as reported:** Tor's single-threaded event-loop architecture makes the described multi-threaded race structurally impossible.

---

## hynv — Critical SENDME Validation Bypass in Tor Congestion Control

**Vulnerability status: not reproducible**

**Claimed:** `congestion_control_vegas_process_sendme()` does not check for excess SENDMEs, causing `cc->inflight` to underflow (uint64) and corrupting RTT calculations.

**Code finding:** `sendme_process_circuit_level()` always calls `sendme_is_valid()` before dispatching to the CC algorithm. Inside `sendme_is_valid()`, `pop_first_cell_digest(circ)` is called. If the sender has not sent the data cells that would trigger a SENDME, the cell-digest queue is empty, `pop_first_cell_digest` returns `NULL`, and the circuit is immediately closed with a `LOG_PROTOCOL_WARN`. An excess SENDME flood (without corresponding data) is caught at this gate and never reaches `congestion_control_vegas_process_sendme`.

For the `dequeue_timestamp` returning 0 scenario: this path is guarded by `time_delta_stalled_or_jumped()` which detects the anomalously large RTT produced by `now_usec - 0` and returns 0, skipping the RTT update.

**Why it does not work as reported:** The `sendme_is_valid` FIFO-digest gate closes the circuit before any CC code path is reached, eliminating the attack vector.

---

## i8fs — Memory Accounting Underestimation in HS Descriptor Parsing

**Vulnerability status: partially reproducible**

**Claimed:** `hs_desc_encrypted_obj_size()` underestimates memory consumption of parsed descriptors, allowing an attacker to exhaust HSDir or client cache beyond configured limits.

**Code finding:** The function at `src/feature/hs/hs_descriptor.c:2982` contains the explicit comment:
```c
/* XXX could follow pointers here and get more accurate size */
intro_size +=
    smartlist_len(data->intro_points) * sizeof(hs_desc_intro_point_t);
```
This only counts the `hs_desc_intro_point_t` struct size and misses: each intro point's `smartlist_t *link_specifiers`, `tor_cert_t *auth_key_cert`, `tor_cert_t *enc_key_cert`, and any key blobs. For descriptors with 20 intro points and many link specifiers the actual allocation can be 2–4× what is accounted.

**Preconditions and limitations:** The attacker must control a hidden service (so they can craft descriptors). The total descriptor size accepted by Tor is bounded (~50KB), limiting the per-descriptor amplification to modest factors. The target must be an HSDir caching descriptors. The result is softly exceeding the configured `MaxHSDirCacheBytes` limit — not an unbounded exhaustion. On modern systems with reasonable RAM this is unlikely to cause a process crash.

**Why it does not work as a severe DoS as reported:** The 50KB descriptor body cap bounds amplification; the OOM subsystem will still evict under memory pressure even with the miscounted sizes. The impact is moderate over-subscription of the cache, not arbitrary memory exhaustion.

---

## k442 — Buffer Overflow in Tor SOCKS4a Hostname Parsing

**Vulnerability status: not reproducible**

**Claimed:** `parse_socks4_request()` in `src/core/proto/proto_socks.c` calculates `hostname_len = (char *)raw_data + datalen - hostname` using attacker-controlled `datalen`, overflowing the `req->address` buffer.

**Code finding:** The function in the target codebase uses a **TRUNNEL-generated parser** (`socks4_client_request_parse`) rather than raw pointer arithmetic. Hostname extraction goes through:
```c
const char *trunnel_hostname =
    socks4_client_request_get_socks4a_addr_hostname(trunnel_req);
size_t hostname_len = strlen(trunnel_hostname);
if (hostname_len < sizeof(req->address)) {
    strlcpy(req->address, trunnel_hostname, sizeof(req->address));
}
```
The TRUNNEL parser itself bounds all fields to the actual received data length. There is no place where user-controlled `datalen` is used directly in pointer arithmetic to compute copy lengths.

**Why it does not work as reported:** The vulnerable pattern described (raw `datalen` pointer arithmetic) was replaced by a TRUNNEL-based parser. The described code does not exist.

---

## l1w0 — Potential DoS in Tor HS Introduction Point Logic

**Vulnerability status: not reproducible**

**Claimed:** `hs_intro_received_establish_intro()` lacks rate limiting, allowing an attacker to exhaust circuit resources by sending repeated malformed ESTABLISH_INTRO cells.

**Code finding:** The attack requires the attacker to have established a circuit to a relay configured as an introduction point. Every malformed ESTABLISH_INTRO cell closes exactly one circuit (via `circuit_mark_for_close`). Establishing circuits is itself rate-limited by Tor's DoS circuit creation defenses (`DoSCircuitCreationEnabled`, `DoSCircuitCreationRate`). An attacker must spend the same resources (circuit slots and bandwidth) as the defender — there is no amplification. The attack is bounded 1:1 and cannot cause unbounded resource exhaustion.

**Why it does not work as reported:** The circuit-creation rate limits on the relay side gate the attack and prevent any net amplification over what the attacker spends.

---

## loo7 — Integer Overflow in `var_cell_new` Leading to Heap Buffer Overflow

**Vulnerability status: not reproducible**

**Claimed:** `var_cell_new(payload_len)` computes `size = offsetof(var_cell_t, payload) + payload_len`, which can overflow on a 32-bit system when `payload_len = 0xFFFF`.

**Code finding:** `payload_len` is `uint16_t` (max 65535). `offsetof(var_cell_t, payload)` is a small constant (≤ 16 bytes on any Tor-supported platform). The sum is at most ~65551. `size_t` on every platform Tor supports (x86, x86-64, ARM) is either 32-bit (4 GB range) or 64-bit. `65551 < 2^32`, so the addition cannot overflow `size_t`. The report's key claim — "wraps around on a 32-bit system" — is numerically false for these operand sizes.

**Why it does not work as reported:** The arithmetic cannot overflow on 32-bit or 64-bit platforms given the uint16_t upper bound on the operand.

---

## m6i4 — Integer Underflow in Hidden Service DoS Mitigation

**Vulnerability status: not reproducible**

**Claimed:** `hs_dos_can_send_intro2()` decrements the token bucket without checking for underflow, allowing bypass of INTRODUCE2 rate limiting.

**Code finding:** The code at `src/feature/hs/hs_dos.c:203` is:
```c
if (token_bucket_ctr_get(&s_intro_circ->introduce2_bucket) > 0) {
    token_bucket_ctr_dec(&s_intro_circ->introduce2_bucket, 1);
}
```
The decrement only occurs when the bucket has tokens (`> 0`). An empty bucket is not decremented. The underflow guard is already in place.

**Why it does not work as reported:** The fix for this specific underflow is already present in the target code.

---

## piqd — Divide-by-Zero in Tor HS PoW Adaptive Rate Limiting

**Vulnerability status: partially reproducible**

**Claimed:** `update_suggested_effort()` in `src/feature/hs/hs_service.c` divides `pow_state->total_effort / pow_state->rend_handled` without checking `rend_handled != 0`.

**Code finding:** The division at line 2726 is real:
```c
pow_state->suggested_effort = MAX(pow_state->suggested_effort + 1,
                                  (uint32_t)(pow_state->total_effort /
                                             pow_state->rend_handled));
```
`rend_handled` is incremented only in `handle_rend_pqueue_cb` when `launch_rendezvous_point_circuit` is actually called. `total_effort` is incremented when a valid request is enqueued. If valid requests arrive and are queued but none are launched before the update period fires, `rend_handled = 0` and `total_effort > 0`. The AIMD INCREASE branch (`max_trimmed_effort > suggested_effort`) can fire in this state, triggering integer division by zero → SIGFPE → process crash.

**Preconditions:** The hidden service must have `has_pow_defenses_enabled = true`. A sufficient burst of valid PoW requests must fill the pqueue faster than they are launched. This can happen naturally (not just via attack) during a genuine load spike on a busy onion service.

**Why the report's claimed attack vector is wrong:** Sending only malformed INTRODUCE1 cells that fail parsing does NOT increment `total_effort` (which only increments after successful enqueue), so `total_effort = 0` and `0/0` produces UB. The real trigger is valid PoW requests overwhelming dispatch, a scenario that requires no adversarial intent.

**Actual root cause:** Missing `if (pow_state->rend_handled == 0) break;` guard in the INCREASE branch of `update_suggested_effort()`. Integer division by zero is UB in C and raises SIGFPE on x86/x64.

---

## q4rb — Memory Exhaustion via Unbounded Extended ORPort Commands

**Vulnerability status: partially reproducible**

**Claimed:** `fetch_ext_or_command_from_buf()` in `src/core/proto/proto_ext_or.c` accepts 16-bit command payload lengths (up to 65535 bytes) without an upper bound, enabling memory exhaustion.

**Code finding:** The code is as described — `len = ntohs(get_uint16(hdr+2))` with no maximum validation; `ext_or_cmd_new(len)` allocates `offsetof(ext_or_cmd_t, body) + len` bytes. Up to 64KB per command can be forced.

**Preconditions and limitations:**
- ExtORPort is **disabled by default**. It must be explicitly configured (`ExtORPort` directive).
- The Extended ORPort cookie authentication must be completed first. The auth cookie is a 32-byte random file readable only by root and the transport proxy process.
- In any legitimate deployment the ExtORPort is bound to 127.0.0.1, not a public interface.
- Therefore, exploitation requires: misconfigured public ExtORPort binding AND obtained auth cookie — both required simultaneously.

**Why it is only partial:** In the default configuration this attack surface does not exist. The report accurately describes the code behavior but overstates risk for standard deployments. Operators who expose ExtORPort without firewall controls and whose auth cookie file is compromised are the realistic victim class.

---

## sjvi — Potential Use-After-Free in Tor Connection Freeing Logic

**Vulnerability status: not reproducible**

**Claimed:** `connection_free_()` does not validate references before freeing, enabling UAF if a connection is referenced elsewhere after being freed.

**Code finding:** The report provides no concrete code path demonstrating an actual double-free or UAF. The PoC sends malformed fixed-cell payloads to a relay's ORPort; these are handled by the link-layer protocol state machine which closes the connection cleanly. There is no identified sequence of events where `connection_free_` is called on a connection that still has live references. The scenario is entirely hypothetical with no supporting code evidence.

**Why it does not work as reported:** No exploitable code path is demonstrated. The PoC elicits normal protocol error handling, not memory corruption.

---

## tr12 — Memory Exhaustion in Tor dirvote Subsystem via Unbounded Vote Size

**Vulnerability status: not reproducible**

**Claimed:** `dirvote_add_vote()` in `src/feature/dirauth/dirvote.c` does not enforce a maximum size for vote bodies, enabling memory exhaustion via large votes.

**Code finding:** `dirvote_add_vote()` processes the vote through `networkstatus_parse_vote_from_string()` and then immediately calls `trusteddirserver_get_by_v3_auth_digest(vi->identity_digest)`. Only the 9–10 known v3 directory authorities (identified by pre-configured cryptographic identity keys) are recognized — any vote from an unknown identity is rejected with "Vote not from a recognized v3 authority". Additionally, the signature on the vote is verified. An attacker cannot forge a vote from a recognized authority and cannot submit unsigned votes.

**Why it does not work as reported:** Authentication via pre-configured authority identity keys (and signature verification) makes unauthorized vote submission impossible. The attack requires compromising a real directory authority.

---

## xhud — DoS Vulnerability in Tor Authority Certificate Parser

**Vulnerability status: not reproducible**

**Claimed:** In `authority_cert_parse_from_string()`, `tor_assert(eos)` after a `memchr` call will abort if no trailing newline follows the `-----END SIGNATURE-----` block.

**Code finding:** The logic at `src/feature/dirparse/authcert_parse.c`:
```c
eos = tor_memstr(eos, end_of_s - eos, "\n-----END SIGNATURE-----\n");
// ^ confirmed: the full "\n-----END SIGNATURE-----\n" substring is present
eos = memchr(eos+2, '\n', end_of_s - (eos+2));
tor_assert(eos);
```
At the second assignment, `eos` points to the start of the 26-character string `"\n-----END SIGNATURE-----\n"`. `eos + 2` points to `"---END SIGNATURE-----\n"`. `memchr` searches for `'\n'` within the remaining buffer. Since `tor_memstr` already confirmed the full `"\n-----END SIGNATURE-----\n"` substring is present (including its trailing `\n`), the final `\n` of that confirmed sequence is always within the search range. `memchr` will always find it; `eos` will never be NULL; `tor_assert` will never fire.

**Why it does not work as reported:** The prior `tor_memstr` call guarantees the exact `\n` that `memchr` seeks is within the buffer. The assert is unreachable via the described input.

---

## y6d1 — Race Condition in Tor Channel Management

**Vulnerability status: not reproducible**

**Claimed:** `channel_mark_for_close()` in `src/core/or/channel.c` has a race condition between concurrent channel close and use operations.

**Code finding:** Same fundamental issue as he6m and fs1y. Tor is a single-threaded event-loop (libevent/kqueue/epoll). All channel state transitions within `channel_mark_for_close`, `channel_change_state`, and callers thereof happen sequentially in one thread. The PoC spawns multiple threads that write to a socket, but Tor processes all bytes from that socket in a single sequential callback. Multi-threaded concurrent channel state access from Tor's own code does not occur. The report has **REJECTED** status from the author's own platform.

**Why it does not work as reported:** The race requires simultaneous multi-threaded access to channel state from within Tor, which the single-threaded event-loop model prevents.

---

## yn6b — Tor Extension Fields Memory Amplification in HS Circuits

**Vulnerability status: not reproducible**

**Claimed:** `trn_extension_parse_into()` in `src/trunnel/extension.c` allows 255 extension fields × 255 bytes each = ~65KB allocation per cell, enabling 138× memory amplification.

**Code finding:** `trn_extension_field_parse_into()` calls:
```c
CHECK_REMAINING(obj->field_len, truncated);
TRUNNEL_DYNARRAY_EXPAND(uint8_t, &obj->field, obj->field_len, {});
obj->field.n_ = obj->field_len;
if (obj->field_len)
    memcpy(obj->field.elts_, ptr, obj->field_len);
```
`CHECK_REMAINING(obj->field_len, truncated)` verifies that at least `obj->field_len` bytes remain in the buffer **before** the dynarray expansion. If `field_len` bytes are not present, parsing returns `-2` (truncated) before any allocation. The outer loop in `trn_extension_parse_into()` similarly validates each field against remaining buffer space. A 498-byte relay payload will not produce more than ~498 bytes of total field allocations; larger claimed lengths return truncated without allocating. The claim of 69KB allocation from a 498-byte payload contradicts the `CHECK_REMAINING` pre-allocation guard.

**Why it does not work as reported:** TRUNNEL parsers allocate only what the input physically provides. The amplification claim was based on a misreading of the generated code that ignores `CHECK_REMAINING`.

---

## b3x1 — Tor RELAY_EXTEND2 Cell Parsing Memory Exhaustion

**Vulnerability status: not reproducible**

**Claimed:** `extend2_cell_body_parse_into()` in `src/trunnel/ed25519_cert.c` allocates up to 65KB per cell by multiplying `n_spec` (u8, max 255) by `ls_len` (u8, max 255), producing large allocations from a 498-byte relay payload.

**Code finding:** `extend2_cell_body_parse_into` first calls `TRUNNEL_DYNARRAY_EXPAND(link_specifier_t *, &obj->ls, obj->n_spec, {})` to pre-expand the pointer array — at most 255 × 8 = 2040 bytes on 64-bit. It then loops calling `link_specifier_parse(&elt, ptr, remaining)`, passing `remaining` (actual bytes left in the buffer) as the length bound. Inside `link_specifier_parse_into`:

```c
CHECK_REMAINING(obj->ls_len, truncated);
remaining_after = remaining - obj->ls_len;
remaining = obj->ls_len;
```

`CHECK_REMAINING(obj->ls_len, truncated)` verifies `obj->ls_len` bytes are physically present before any allocation; if not, parsing returns `-2` without allocating. Each successive call to `link_specifier_parse` shrinks `remaining`; once the 498-byte payload is exhausted, parsing of further specifiers fails and the partially-built struct is freed by `extend2_cell_body_free`. Total allocation is bounded by the actual input size, not by the `n_spec` field value.

**Why it does not work as reported:** Same TRUNNEL `CHECK_REMAINING` guard as `dwi0` and `yn6b`. Amplification beyond the physical payload size is impossible.

---

## ck0t — Tor Hidden Service ESTABLISH_INTRO Cell Memory Exhaustion

**Vulnerability status: not reproducible**

**Claimed:** `trn_cell_establish_intro_parse_into()` allocates 130KB per cell (`auth_key_len=65535` + `sig_len=65535` + extensions ~69KB), a ~260× amplification from a 498-byte payload.

**Code finding:** In `src/trunnel/hs/cell_establish_intro.c`, every variable-length field allocation is preceded by a `CHECK_REMAINING` call:

```c
CHECK_REMAINING(obj->auth_key_len, truncated);
TRUNNEL_DYNARRAY_EXPAND(uint8_t, &obj->auth_key, obj->auth_key_len, {});
...
CHECK_REMAINING(obj->sig_len, truncated);
TRUNNEL_DYNARRAY_EXPAND(uint8_t, &obj->sig, obj->sig_len, {});
```

If `auth_key_len=65535` but only 498 bytes are present, `CHECK_REMAINING` returns `-2` (truncated) before any dynarray allocation. The extension sub-parser follows the same pattern. No allocation can exceed the bytes physically present in the input buffer.

**Why it does not work as reported:** Identical TRUNNEL defense as `b3x1`, `dwi0`, `yn6b`. Amplification requires data that does not fit in a relay cell.

---

## dopl — Multiple Assertion Vulnerabilities in Hidden Service Descriptor Parsing

**Vulnerability status: reproducible**

### Claim

`src/feature/hs/hs_descriptor.c` declares two introduction-point tokens with `OBJ_OK` (object optional), but the parsing functions that consume them unconditionally call `tor_assert(tok->object_body)` without any prior NULL guard. An attacker running a rogue hidden service can publish a descriptor with a bare `enc-key-cert` line that carries no PEM block; every Tor client that attempts to connect fetches and parses the descriptor, reaches the unconditional assertion, and aborts.

### Token table (lines 168, 170)

```c
T1(str_ip_enc_key_cert,     R3_INTRO_ENC_KEY_CERT,      ARGS, OBJ_OK),
T01(str_ip_legacy_key_cert, R3_INTRO_LEGACY_KEY_CERT,   ARGS, OBJ_OK),
```

`OBJ_OK` is defined in `src/feature/dirparse/parsecommon.h:228` as "object is optional." The implementation in `parsecommon.c:247` reads:

```c
case OBJ_OK:
    /* Anything goes with this token. */
    break;
```

When the keyword line is present but has no following `-----BEGIN … -----END` block, the tokenizer produces a token with `tok->object_body = NULL` and `tok->object_size = 0` — and no error is raised.

### First assertion site — `R3_INTRO_ENC_KEY_CERT` (line 1932)

```c
/* Exactly once "enc-key-cert" NL certificate NL */
tok = find_by_keyword(tokens, R3_INTRO_ENC_KEY_CERT);
tor_assert(tok->object_body);          /* crashes if no PEM block present */
```

`R3_INTRO_ENC_KEY_CERT` is a required token (`T1`), so `find_by_keyword` always returns non-NULL. But `OBJ_OK` means `tok->object_body` may be NULL, and there is no conditional guard before the assertion. A descriptor whose inner plaintext contains a bare `enc-key-cert ntor <base64>` line (no `-----BEGIN ED25519 CERT-----` block) will reach this assertion and abort any client process.

### Second assertion site — `R3_INTRO_LEGACY_KEY_CERT` (line 1774)

```c
tok = find_opt_by_keyword(tokens, R3_INTRO_LEGACY_KEY_CERT);
if (!tok) {
    log_warn(LD_REND, "Introduction point legacy key cert is missing");
    goto err;
}
tor_assert(tok->object_body);          /* crashes if token present but has no PEM block */
```

The `!tok` branch handles the case where the token is absent entirely. When the token is present but carries no PEM object body, the guard passes and the assertion fires. This path is only reached when the intro point also contains a `legacy-key` line, making it a secondary vector.

### Attack path (primary vector)

1. The attacker controls a v3 hidden service and modifies `encode_enc_key()` in the rogue build to emit:
   ```
   enc-key-cert ntor <base64>
   ```
   instead of the normal two-part form (keyword + PEM block).
2. Because `hs_desc_encode_descriptor` performs a round-trip decode check for non-client-auth descriptors, the rogue's own encoding would trigger the same assertion. The PoC disables that self-check (`do_round_trip_test = false`) before publishing.
3. The malformed content is hidden inside the doubly-encrypted inner layer, which HSDirs cannot decrypt. HSDirs store and serve the blob without parsing it. Only clients that know the `.onion` address and attempt to connect will decrypt the inner layer and reach `decode_intro_point`.
4. Any such client hits `tor_assert(tok->object_body)` at `hs_descriptor.c:1932` and aborts.

### Code path to crash

```
hs_client_dir_fetch_done()
  → hs_cache_store_as_client()
    → hs_client_decode_descriptor()
      → hs_desc_decode_descriptor()
        → hs_desc_decode_superencrypted()
          → hs_desc_decode_encrypted()
            → decode_intro_points()
              → decode_intro_point()    ← tor_assert(tok->object_body) fires
```

The stack trace in the report (`hs_descriptor.c:1932: decode_introduction_point: Assertion tok->object_body failed`) matches this path exactly, with `hs_desc_decode_descriptor` calling down to `decode_intro_point` via the encrypted layer decoder.

### Client scope

Only Tor clients that actively try to connect to the rogue address are affected. HSDir relays call only `hs_desc_decode_plaintext()` (outer header) and never decrypt or parse the inner layer. Guard, middle, exit, intro, and rendezvous relays are unaffected. A single published descriptor crashes all clients connecting to the address; automatic hourly republication sustains the DoS indefinitely.

### Why this reproduces

Both assertion sites are confirmed present in the unmodified target codebase at their reported lines. The `OBJ_OK` case in `parsecommon.c` explicitly does no enforcement ("anything goes"). No null-guard has been added between `find_by_keyword`/`find_opt_by_keyword` and either `tor_assert` call. The mismatch between the token's declared optionality of its object and the code's unconditional assumption that the object is present is intact in the target.

---

## foh4 — Heap Information Leak in Tor's Variable-Length Cell Handling

**Vulnerability status: not reproducible**

**Claimed:** `fetch_var_cell_from_buf()` allocates `sizeof(var_cell_t) + payload_len` but only copies `payload_len` bytes, leaving the leading `sizeof(var_cell_t)` bytes of the allocation uninitialized and available for return-of-heap-data exploitation.

**Code finding:** Three factual errors in the report:

1. **`tor_malloc_zero`, not `tor_malloc`**: `var_cell_new(length)` is implemented as `tor_malloc_zero(offsetof(var_cell_t, payload) + length)`, which zero-initializes the entire allocation. No uninitialized bytes exist.

2. **`offsetof`, not `sizeof`**: The allocation size is `offsetof(var_cell_t, payload) + payload_len`. The struct fields before `payload` (circ_id, command, payload_len) are set explicitly by the caller after allocation. The allocation size exactly covers the struct header plus payload — there is no excess padding between the struct fields and the payload.

3. **Buffer completeness pre-check**: `fetch_var_cell_from_buf` checks `if (buf_datalen(buf) < (size_t)(header_len+length)) return 1;` before allocating. It only allocates and calls `buf_peek(buf, (char*) result->payload, length)` when sufficient bytes are already in the buffer, so all `length` payload bytes are read.

The manual assessment note embedded in the report file itself records: *"tor_alloc_zero, not tor_alloc; offsetof, not sizeof; data buf len is checked."*

**Why it does not work as reported:** All three premises of the attack are factually incorrect per the actual source.

---

## jpis — Potential Use-After-Free in Tor's Circuit Extension Logic

**Vulnerability status: not reproducible**

**Claimed:** `onion_extend_cpath()` calls `extend_info_dup(state->chosen_exit)` at `circuitbuild.c:2525` without a NULL guard, enabling NULL dereference or use-after-free if `chosen_exit` is NULL.

**Code finding:** `extend_info_dup` opens with `tor_assert(info)`:

```c
extend_info_t *
extend_info_dup(extend_info_t *info)
{
  extend_info_t *newinfo;
  tor_assert(info);          /* aborts process if info == NULL */
  ...
```

If `state->chosen_exit` were NULL, the call would trigger `tor_assert(NULL)` and abort the process — not a UAF. The report's "use-after-free" characterisation is incorrect; the outcome would be an assertion failure crash.

Operationally, `state->chosen_exit` is populated at circuit construction time via `state->chosen_exit = extend_info_dup(exit_ei)` (line 2154). The branch `cur_len == state->desired_path_len - 1` in `onion_extend_cpath` is only reached during normal hop extension for a circuit that was set up with a specific exit. Circuits without a chosen exit node use a different code path for exit selection prior to reaching this function. The report concedes the issue "is not directly exploitable by remote attackers" and requires manipulating in-process data structures.

**Why it does not work as reported:** The consequence of a NULL `chosen_exit` is a `tor_assert` abort, not a UAF. `state->chosen_exit` is set during circuit construction and is not NULL at this call site under normal or remotely-influenced operation.

---

## lmer — Double-Free in Tor Circuit Management via TRUNCATE Cell Processing

**Vulnerability status: not reproducible**

**Claimed:** `n_chan_create_cell` is freed at `circuitbuild.c:752` without being set to NULL, then the TRUNCATE cell handler at `relay.c:1922` frees it again, producing a double-free.

**Code finding:** Both free sites use the `tor_free()` macro, which both frees **and** NULLs the pointer:

- `circuitbuild.c:752`: `tor_free(circ->n_chan_create_cell);` → after this, `circ->n_chan_create_cell == NULL`
- `relay.c:1922`: `tor_free(circ->n_chan_create_cell);` → pointer is already NULL; expands to `raw_free(NULL)`, which is defined as a no-op by the C standard

The assertion at `circuitlist.c:586` — `tor_assert(!circ->n_chan_create_cell)` on transition to `CIRCUIT_STATE_OPEN` — confirms the design intent: the pointer must be NULL in open state. This assertion passes precisely because `tor_free` has already zeroed it by the time `circuit_set_state` is called.

**Why it does not work as reported:** Same `tor_free` macro semantics as report `8i5d`. The macro auto-nulls on first call; the second free is a safe no-op. No heap corruption is possible.

---

## Summary Table

| Reference | Title (short)                              | Status               |
|-----------|--------------------------------------------|----------------------|
| 2lea      | EXTENDED2 integer underflow                | not reproducible     |
| 8i5d      | Circuit padding UAF                        | not reproducible     |
| 9qtg      | Descriptor parsing memory corruption       | not reproducible     |
| b3x1      | EXTEND2 link-specifier memory exhaustion   | not reproducible     |
| ck0t      | ESTABLISH_INTRO auth_key/sig exhaustion    | not reproducible     |
| dopl      | HS descriptor assertion on missing PEM     | reproducible         |
| dwi0      | INTRODUCE cell length amplification        | not reproducible     |
| foh4      | Heap info leak in var-cell handling        | not reproducible     |
| fs1y      | DESTROY-RELAY race UAF                     | not reproducible     |
| he6m      | OR connection close race UAF               | not reproducible     |
| hynv      | SENDME CC bypass                           | not reproducible     |
| i8fs      | HS descriptor memory accounting            | partially reproducible |
| jpis      | Circuit extension NULL/assert crash        | not reproducible     |
| k442      | SOCKS4a hostname buffer overflow           | not reproducible     |
| l1w0      | HS intro point circuit exhaustion          | not reproducible     |
| lmer      | Double-free via TRUNCATE cell              | not reproducible     |
| loo7      | `var_cell_new` integer overflow            | not reproducible     |
| m6i4      | HS DoS token bucket underflow              | not reproducible     |
| piqd      | HS PoW divide-by-zero                      | partially reproducible |
| q4rb      | ExtORPort command memory exhaustion        | partially reproducible |
| sjvi      | Connection freeing UAF                     | not reproducible     |
| tr12      | dirvote unbounded vote memory exhaustion   | not reproducible     |
| xhud      | Authority certificate parser assert crash  | not reproducible     |
| y6d1      | Channel management race UAF                | not reproducible     |
| yn6b      | Extension fields memory amplification      | not reproducible     |

---

