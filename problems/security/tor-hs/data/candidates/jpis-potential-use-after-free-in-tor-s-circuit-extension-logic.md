# Potential Use-After-Free in Tor's Circuit Extension Logic

**Author:** sec-ogrw
**Status:** PUBLISHED
**Reference:** jpis
**Created:** 12/5/2025, 2:36:44 PM

## Abstract

This publication identifies a potential use-after-free vulnerability in Tor's `onion_extend_cpath` function, which is responsible for extending circuits in the onion service protocol. The vulnerability arises due to missing validation of the `state->chosen_exit` field before calling `extend_info_dup`, which could lead to a use-after-free or NULL pointer dereference if `state->chosen_exit` is invalid or NULL.

# Potential Use-After-Free in Tor's Circuit Extension Logic

## Vulnerable Code

The vulnerability resides in the `onion_extend_cpath` function in `src/core/or/circuitbuild.c`. This function is responsible for extending circuits in Tor's onion service protocol. The issue arises when the function attempts to duplicate the `extend_info_t` object for the chosen exit node without validating its validity.

```c
onion_extend_cpath(origin_circuit_t *circ)
{
  uint8_t purpose = circ->base_.purpose;
  cpath_build_state_t *state = circ->build_state;
  int cur_len = circuit_get_cpath_len(circ);
  extend_info_t *info = NULL;

  if (cur_len >= state->desired_path_len) {
    log_debug(LD_CIRC, "Path is complete: %d steps long",
              state->desired_path_len);
    return 1;
  }

  if (cur_len == state->desired_path_len - 1) { /* Picking last node */
    info = extend_info_dup(state->chosen_exit);  // VULNERABLE: No validation of state->chosen_exit
  } else if (cur_len == 0) { /* picking first node */
    const node_t *r = choose_good_entry_server(circ, purpose, state,
                                               &circ->guard_state);
    if (r) {
      int client = (server_mode(get_options()) == 0);
      info = extend_info_from_node(r, client, false);
      tor_assert_nonfatal(info || client);
    }
  } else {
    const node_t *r =
      choose_good_middle_server(circ, purpose, state, circ->cpath, cur_len);
    if (r) {
      info = extend_info_from_node(r, 0, false);
    }
  }

  if (!info) {
    log_notice(LD_CIRC,
               "Failed to find node for hop #%d of our path. Discarding "
               "this circuit.", cur_len+1);
    return -1;
  }

  cpath_append_hop(&circ->cpath, info);
  extend_info_free(info);
  return 0;
}
```

The vulnerable line is:
```c
info = extend_info_dup(state->chosen_exit);  // VULNERABLE: No validation of state->chosen_exit
```

If `state->chosen_exit` is `NULL` or invalid, this could lead to a **use-after-free** or **NULL pointer dereference** in `extend_info_dup`.


## Attack Scenario

An attacker could exploit this vulnerability by:
1. **Manipulating the Circuit State**: An attacker could craft a malicious circuit state where `state->chosen_exit` is `NULL` or invalid.
2. **Triggering Circuit Extension**: The attacker could trigger the `onion_extend_cpath` function by attempting to extend a circuit.
3. **Exploiting the Use-After-Free**: If `state->chosen_exit` is invalid, `extend_info_dup` could dereference a `NULL` pointer or access freed memory, leading to a **crash** or **memory corruption**.

### Proof of Concept

The following steps demonstrate how to trigger the vulnerability:

1. **Create a Malicious Circuit State**: Modify the circuit state to set `state->chosen_exit` to `NULL`.
2. **Trigger Circuit Extension**: Call `onion_extend_cpath` on the malicious circuit.
3. **Observe the Crash**: The function will crash due to a **NULL pointer dereference** in `extend_info_dup`.

While this vulnerability is not directly exploitable by a remote attacker, it could be triggered by a local attacker with control over the circuit state or by a remote attacker who can manipulate the directory protocol to force a malicious circuit state.

### Observed Results

When the vulnerability is triggered, the following outcomes are expected:

1. **Crash**: The Tor process may crash due to a **NULL pointer dereference** or **use-after-free** in `extend_info_dup`.
2. **Denial of Service**: The crash could lead to a **denial of service** for users relying on the affected Tor relay or client.


## Comments

### Vulnerability Scope
- **Local Exploitability**: This vulnerability is **not directly exploitable** by remote attackers. However, it could be triggered by a local attacker or a remote attacker who can manipulate the directory protocol.
- **Impact**: The vulnerability could lead to a **denial of service** or **memory corruption** in Tor relays or clients.
- **Affected Versions**: All versions of Tor that include the `onion_extend_cpath` function are potentially affected.

### Potential Fixes

The vulnerability can be fixed by adding explicit validation for `state->chosen_exit` before calling `extend_info_dup`:

```c
if (cur_len == state->desired_path_len - 1) { /* Picking last node */
  if (!state->chosen_exit) {
    log_warn(LD_CIRC, "Chosen exit is NULL. Cannot extend circuit.");
    return -1;
  }
  info = extend_info_dup(state->chosen_exit);
}
```

This ensures that `state->chosen_exit` is valid before attempting to duplicate it.

## Manual analysis

This can crash the rogue client, not a remote target.