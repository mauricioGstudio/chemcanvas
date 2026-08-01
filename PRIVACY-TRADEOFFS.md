# Privacy trade-off audit

Every feature that is currently limited by keeping data on-device, what
relaxing that would buy, and what it would cost. Written so the calls are
easy to make later rather than re-derived each time.

Ordered by value-per-cost, best first.

---

## Already shipped

### 1. Precise 3D geometry — **shipped in 2.1.0**
- **Unlocks:** properly embedded 3D coordinates instead of geometry derived
  from idealized bond angles. Measurably better: morphine's bridged cage goes
  from a stretched 1.68 Å bond to a correct 1.54 Å; caffeine's C=O lands on
  the true 1.22 Å.
- **Costs:** the structure (as SMILES) is sent to NCI CACTUS, a US National
  Cancer Institute service.
- **Mitigation shipped:** local geometry renders first so the viewer never
  waits on the network; the remote result swaps in when it arrives. There's a
  "Precise 3D" toggle, the HUD says which geometry you're looking at, and
  everything still works offline.

### 2. Name lookup and structure identification — shipped in 1.0.0
- Already sends typed names / structures to PubChem and OPSIN.

---

## Worth doing next

### 3. Auto-update
- **Unlocks:** users actually get fixes. Right now a bug shipped in an
  installer lives on every machine that downloaded it, forever.
- **Costs:** the app periodically contacts an update server, which sees IP,
  version, and roughly how often the app runs.
- **Verdict:** the strongest remaining candidate. Cost is minimal, and the
  status quo (users stuck on a broken build) is worse for them than the ping.

### 4. Crash and error reporting
- **Unlocks:** knowing that, say, conformer generation throws on some class of
  structure. Currently a crash is invisible unless someone reports it.
- **Costs:** stack traces leave the machine; naive setups capture the
  structure that caused the crash, which is the sensitive part.
- **Verdict:** worth it *if* the payload is scrubbed to the error and code
  path only, never the molecule.

### 5. Anonymous usage analytics
- **Unlocks:** which features are used, so effort goes to what people touch.
- **Costs:** per-session events; with a molecule editor it's easy to leak more
  than intended if event properties include structures.
- **Verdict:** worth it for feature-level counters only. Never log structures.

---

## Bigger features that need a server

### 6. Real IUPAC name generation
- **Unlocks:** naming *novel* structures. Today "Name this structure" can only
  recognize compounds PubChem already holds — a genuinely new molecule comes
  back "not found," which is the honest answer but not a useful one.
- **Costs:** structure goes to a commercial naming API. Also a licensing cost.
- **Verdict:** the single biggest capability gap in the app.

### 7. Property and spectra prediction (logP, pKa, predicted NMR/IR)
- **Unlocks:** the kind of output that makes this useful for coursework and
  lab writeups.
- **Costs:** structures sent to a prediction service.
- **Verdict:** high value for the target audience. Predicted NMR in particular
  pairs well with how the app already gets used.

### 8. Retrosynthesis / reaction prediction
- **Unlocks:** suggested routes to a target.
- **Costs:** structures to a heavy ML service; not runnable client-side.
- **Verdict:** impressive but far out of scope for now.

### 9. Cloud save, sync, and share links
- **Unlocks:** open your work on another machine; send someone a link.
- **Costs:** the app stops being local-only in any meaningful sense — it needs
  accounts, storage, and a real security posture.
- **Verdict:** the largest change in character. Do it only if the product is
  meant to become a service rather than a tool.

---

## Not worth it

- **Cloud rendering / cloud hand-tracking.** Both run fine on-device; sending
  camera frames anywhere would be a large cost for no gain.
- **CDN-hosted fonts and models.** Saves a few MB of repo size in exchange for
  every visitor's IP going to a third party on page load. Self-hosting is
  already done and costs nothing meaningful.

---

## One thing worth keeping in mind

The audience is chemists and chemistry students. A structure that hasn't been
published or filed yet is sensitive in a way that ordinary app telemetry is
not — sending it to a third party can matter for novelty and IP, and some labs
prohibit it outright.

That's not an argument against any of the above. It's the reason each of these
should stay switchable and clearly labeled, the way precise 3D now is: the
people most likely to care are exactly the intended users, and they will
mostly be fine with it as long as they can see it and turn it off.
