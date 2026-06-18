# Category Quality Review

Use this checklist after Lishu writes a generated output folder. The goal is to decide whether the category structure is useful enough to keep, not to audit every bookmark one by one.

## Quick Checks

- Confirm the original bookmark tree is still unchanged. Review the generated `📚 理书整理 ...` folder as a separate copy.
- Scan category names for duplicate meanings, vague buckets, and overly broad catch-all groups.
- Check the largest categories first. Spot-check several bookmarks in each large category and verify the category name would help you find them later.
- Check very small categories. A few single-bookmark categories may be fine, but many tiny categories usually mean the model overfit.
- Compare the generated categories with your original top-level bookmark folders. They do not need to match, but large mismatches should be explainable.
- Look for mixed-purpose groups, such as product docs mixed with personal reading, or provider setup links mixed with unrelated articles.

## When To Re-Run

Re-run with different settings when:

- Many bookmarks land in vague categories such as "Other", "Tools", or "Resources".
- Category names overlap enough that you would not know where to look later.
- Local models return unstable or overly generic JSON/category output.
- Homepage meta scraping would likely help because many bookmark titles are missing or unclear.

See [PROVIDERS.md](PROVIDERS.md) for provider/model trade-offs and local-model JSON troubleshooting. Re-runs are non-destructive: Lishu creates a separate generated folder each time.

## Before Manual Cleanup

- Keep the generated folder as a comparison layer before deleting or moving anything manually.
- Use the duplicate URL report as a read-only hint, not an automatic cleanup command.
- Do not judge quality from screenshots that use synthetic sample data; use a real private run for your own decision, and keep private data out of public screenshots.
