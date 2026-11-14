# Windows job and AppContainer experiments

Status: candidate only. Neither the local-verification controller gate nor the
packaging gate is opened. No production startup path selects the adapter.

`apps/desktop/native/job-broker/JobBroker.cs` is a Windows lifecycle launcher.
It creates its child suspended, assigns it to a kill-on-close job with no
breakaway limits, verifies membership, then resumes it. It gives the child only
duplicated standard input/output/error handles through an explicit handle list.
If assignment fails, the suspended process is terminated. Closing the job on
normal completion or broker death terminates its remaining members. The
`createDoudianJobHost` adapter composes this launcher with the existing TD stdio
transport and does not fall back to a direct launch when the broker is missing.

This job does not enforce file or network policy. The adapter is not a trusted
broker authentication mechanism: it does not verify broker or child binary
identity, bind them to a signed manifest, authenticate peers, prevent same-user
handle duplication, scrub the inherited environment, or protect the launch from
path replacement. The job process itself is outside its job and can access host
resources. It must not be exposed to untrusted arguments or enabled in product
before those issues and the other boundaries below are addressed. No claims are
made about hostile same-user processes, other launch paths, or inherited
handles that the allowed child itself deliberately shares with descendants.

## Observations on 2026-11-15

- The compiled native test launched real synthetic processes. In the control,
  the grandchild survived its parent and `CREATE_BREAKAWAY_FROM_JOB` succeeded;
  under the new job, breakaway failed with Windows error 5. Both the child and
  grandchild terminated after graceful parent exit and after forcibly killing
  the broker. A missing executable returned 125 without launching a child.
- A separate inheritable event was visible and signaled in the direct-launch
  positive control. The job-launched fixture could not signal it. This checks
  one unrelated inherited handle, not all possible handle or IPC attacks.
- The Electron adapter ran real stdio initialize and capabilities requests
  against the existing `td-unicode-pipe-20261114/host/HermesHostIsolationTests.exe`
  synthetic TD host. It uses fake engines, not a shop. An invalid relative
  broker path and a missing broker were rejected. Four Vitest files: 37 passed;
  Electron TypeScript `--noEmit` passed.
- The existing AppContainer synthetic probe was also launched through the job.
  It reported the child and grandchild as AppContainer members with the same
  profile SID; both wrote in their granted synthetic directory, and both were
  denied reads and writes to the sibling synthetic file. The host read control
  succeeded and the protected content remained unchanged. Host loopback TCP and
  UDP controls succeeded; both container processes timed out. The profile API
  reported successful deletion and the temporary directory was removed.
- The new `AppContainerNetworkProbe` was run through the job on the machine's
  local IPv4 `192.168.1.5`. Its TCP, UDP and simulated DNS endpoints bound only
  that local address. Host controls all succeeded. Both AppContainer processes
  timed out for each; the server saw exactly the one host-control UDP and DNS
  packet and no pending TCP connection after accepting the host control. DNS
  here is a synthetic DNS-shaped datagram sent directly to a local echo server,
  not an OS resolver test. Timeouts establish only these observations, not a
  general egress policy or proof that packets cannot go elsewhere. The API
  reported successful profile deletion and removed the temporary directory.

No real shop, credentials, external DNS service, deployment, firewall change,
or Chromium sandbox-disabling option was used. The probe creates and deletes a
random per-user AppContainer profile and changes the ACL of its synthetic temp
directory; abnormal termination can leave the profile or directory behind.

## Reproduction

From the repository root on Windows, compile each of `JobBroker.cs`,
`JobFixture.cs`, `JobBrokerTests.cs` and `AppContainerNetworkProbe.cs` with
`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /platform:x64`, placing
executables in a dedicated output directory. Run `JobBrokerTests.exe` with the
absolute paths to `JobBroker.exe` and `JobFixture.exe`. To repeat the network
test, run `JobBroker.exe <absolute AppContainerNetworkProbe.exe> <local IPv4>`;
the probe rejects loopback and addresses not assigned to the host. It creates
only local listeners and requires no elevated privileges on this machine.

For the Electron integration test, set `HERMES_TEST_JOB_BROKER` and
`HERMES_TD_TEST_HOST` to the absolute synthetic executable paths and run Vitest
with `apps/desktop/vitest.isolation.config.ts`. The existing localprep command
still exits 1 with `runtime isolation is integrated and verified` unavailable.

## Blockers

The prior version-matched Electron investigation recorded Chromium's
`SBOX_ERROR_CANNOT_CREATE_WINSTATION` and `ERROR_ACCESS_DENIED` for both observed
`CreateWindowStationW` attempts inside AppContainer. The precise Windows access
check remains unknown. No interactive Electron GUI, renderer, or real browser
descendant has been shown to work in this boundary with Chromium sandbox enabled.
The job plus probe is not a packaged Electron/TD run, and the network probe did
not check external IPs, IPv6, DNS resolution, reparse races, impersonation,
broker authentication, or hostile process escape. A scoped authenticated
broker, trusted binary and IPC identity, race-resistant filesystem policy,
complete environment/handle control, and real packaged process-tree tests are
still required before either gate can be reviewed.
