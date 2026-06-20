# Guest OS strategy & licensing

This answers two decisions raised early on:

1. Should we build our **own custom Linux OS**?
2. We want an **MIT-licensed Linux** we can customize, use, and sell commercially.

## TL;DR

- **Don't build a custom OS now.** Use stock **Debian** (or Ubuntu) cloud images
  for the workspace desktop — that *is* the "Ubuntu-like" experience users expect,
  with the largest app ecosystem. A custom OS is a Phase 2/3 optimization, and
  only for the **disposable sandbox guest** (minimal, fast-boot, tiny attack surface).
- **There is no such thing as an "MIT Linux."** The Linux **kernel is GPLv2** and
  can't be relicensed. But that does **not** block you: GPLv2 explicitly allows
  **commercial use, customization, and redistribution**. The only obligation is to
  offer source for the GPL-licensed components you ship/modify — it does **not**
  reach your separate userspace application (SafeVM).
- Keep **SafeVM's own code MIT**; keep **guest-image licensing** a separate,
  documented concern. The two are independent.

## Why not a custom OS (yet)

A custom distro is months of undifferentiated work (package management, security
updates, hardware/driver support, CVE tracking) that adds **zero** product value
for the MVP. Users asked for "an OS like Ubuntu" — so give them Ubuntu/Debian.
Your moat is the **orchestration, sandbox, and policy**, not a bespoke distro.

**Where a custom guest *is* justified — later:** the disposable sandbox wants a
**minimal, hardened, snapshot-bootable rootfs** (sub-second cold start, no shell,
no package manager, no network stack it doesn't need). Build that with
**Buildroot** or an **Alpine** base in Phase 2/3 — not a full desktop distro.

## Base-image options

| Base | License posture | Redistribute / rebrand commercially | Best for |
|---|---|---|---|
| **Debian** | DFSG-free; no single-vendor trademark friction | ✅ cleanest for rebranding | **Workspace desktop (recommended)** |
| **Ubuntu** | Free to redistribute; "Ubuntu" name is trademarked | ✅ (remove trademarks if rebranding) | Workspace desktop (most familiar) |
| **Alpine** | musl (MIT) + busybox (GPLv2); tiny | ✅ | Minimal sandbox guest |
| **Buildroot / Yocto** | *You* pick each package's license (Yocto tooling is MIT) | ✅ | Custom minimal sandbox rootfs |

**Recommendation:** Debian for the desktop workspace (no trademark friction when
you rebrand to the eventual product name), Alpine/Buildroot for the sandbox guest.

## What the SafeVM Community License requires

SafeVM's own code is **source-available under the [SafeVM Community License](../LICENSE)**
(owned by Altailab LLC), not MIT. The goal — *let anyone run it
freely, including commercially, while preventing a competitor from reselling a
modified fork* — is achieved as follows:

1. **SafeVM's code** (this repo): **SafeVM Community License.** Free to run
   unmodified, including commercially; commercial use of a **modified** version
   needs a commercial license from Altailab LLC.
2. **Guest OS images** you ship: a **mix** of upstream licenses (kernel = GPLv2,
   plus per-package licenses). You may redistribute them commercially; the
   obligation is to **make the corresponding source available** for GPL/copyleft
   components (trivially satisfied by pointing at the upstream distro, or hosting
   the source for anything you modify). This obligation lives at the **image
   layer** and does **not** infect SafeVM's application code — they run as
   separate processes / in separate VMs, not linked into one binary.
3. Ship a **`NOTICE` / image manifest** listing the components and licenses in
   each golden image. Standard practice; cheap to automate in the image pipeline.

## The open-core defensibility (important)

Two layers protect the business:

1. **The Community License** stops a competitor from taking the open code,
   modifying it, and reselling the modified fork commercially — that requires a
   commercial license from Altailab LLC. (Unmodified commercial use stays free, by
   design — that's the adoption funnel.)
2. **The multi-tenant / cloud control plane stays in a *separate, private*
   repository** under a fully commercial license — it is not published at all.

> **Keep the multi-tenant / cloud control plane out of this repo entirely.**

The `tenantId` seam in the schema lets the private cloud layer extend the
Community core cleanly without forking it. This is the standard open-core split
(source-available core + proprietary commercial add-ons).

## Action items

- [ ] Add a `NOTICE` file + per-image license manifest once the image pipeline exists.
- [ ] Phase 1: workspace images from **Debian** cloud image + streaming server.
- [ ] Phase 2: minimal **Alpine/Buildroot** sandbox guest (snapshot boot).
- [ ] Create the **private** `safevm-cloud-enterprise` repo for multi-tenant code.
