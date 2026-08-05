# The judge may promote freely but may not demote into archive

The judge can move a message up — out of archive or unmatched, and between new, review, and priority — without confirmation. It cannot move a message **into** archive without a human confirming, and it cannot touch `protected` mail at all.

The asymmetry exists because archive is wired to a destructive action. The danger-zone purge moves everything under the archive label to Gmail Trash, which is defensible while only the owner's own rules put mail there. If the judge could file into archive, the chain becomes: model misfiles, owner later purges, and the model has silently placed a message in a deletion queue — precisely what the app's "deletion is explicit and opt-in" posture exists to prevent.

`protected` is left alone because it means the owner starred the message, whitelisted the sender, or the sender could not be parsed. The deterministic pass refuses to touch these on principle, and there is no reason a model should inherit less restraint than the rules it is auditing.

The direction of the asymmetry matches the cost asymmetry already accepted for eval scoring: pulling a wrongly-archived bill up into priority is the most valuable thing this feature does, while filing something away is the error you cannot see and may not recover from.
