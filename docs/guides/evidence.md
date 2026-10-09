# Keep a useful test report

A useful report lets another person understand what failed and repeat the same test. Save the case ID, inputs, Vortex version, expected result, observed result, and the files that show it.

For a small script, save its relevant output alongside a screenshot. For performance work, the [benchmark runner](../testing/benchmarks.md) writes structured results, repeat statistics, and any comparison you requested.

## Separate timing from correctness

A deployment duration does not prove the files deployed correctly. Include a file or UI assertion in the case. A failed or blocked case should explain the assertion or missing prerequisite; it should not produce an apparently successful performance result.

## Keep the context

Record the collection revision and cache mode for real downloads. Record the generated row count and files per mod for synthetic tests. Keep hardware, storage, bandwidth, security settings, and starting state fixed between comparisons.

Use [screenshots](capture.md) to explain visual problems. CPU profiles can help explain a slowdown after you reproduce it; profiling itself adds overhead, so collect it in a separate diagnostic run.

Before sharing an artifact, check for account information, credentials, personal paths, or unrelated content. See [security and privacy](../security.md).
