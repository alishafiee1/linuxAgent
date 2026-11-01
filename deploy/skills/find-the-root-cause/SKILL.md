---
name: Find the root cause
description: Debug by evidence, not guesses. Use for any bug, failed test or strange behaviour, before changing code.
---
# Find the root cause

Do not change anything until you can explain the failure.

1. **Reproduce** it, and write down the exact command and error.
2. **Read** the whole error and the logs. Check what changed recently.
3. **Trace** the bad value back to where it first goes wrong. Fix it there, not where it shows up.
4. **One idea at a time.** State a hypothesis, and test it with the smallest check.
5. **Fix once.** Add a test that fails without the fix when you can.
6. **Three failed fixes means stop:** the understanding is wrong, or the design is. Tell the user what you learned.
