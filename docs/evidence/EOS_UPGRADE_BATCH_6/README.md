# Batch 6 local evidence

This directory records local verification for the eighteen features in
`EOS_UPGRADE_BATCH_6.md`. Generated command logs and mounted component screenshots
are local evidence. They do not establish hosted migration application, real JWT
or Storage authorization, independent database-session concurrency, physical
weighing or operator acceptance.

The [batch report](../../../EOS_UPGRADE_BATCH_6.md) records the source checkpoint,
command exits, test totals, audit repairs and hosted/operator acceptance boundaries.

Final evidence uses the `*-verified-final.txt` logs. Lint and typecheck exit 0,
the production Webpack build generates 205 pages, and the complete suite passes
2,842 tests across 76 suites with zero failures or skips. Schema replay passes
282/282 files (two baseline files and 280 migrations). The visual register records
24 clean styled captures across twelve desktop/phone views, including a regression
for contained, usable horizontal bundle-table scrolling.

The feature SQL/unit run passes 64/64. The overlapping purchasing/practice run
passes 16/16, including five offline mounted purchasing tests. These cases are also
included in the complete suite; their totals must not be added together.

Other logs retain earlier fixture failures, denied sandbox access, the first passing
full suite and the mobile overflow discovered afterward. The final visual pass and
second complete suite passed after that layout repair. Earlier logs are intermediate
checkpoints and do not override the verified final evidence.
