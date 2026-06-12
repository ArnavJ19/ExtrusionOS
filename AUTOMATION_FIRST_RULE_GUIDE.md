# Automation: First Rule Guide

This guide helps owners/admins create their first safe automation in ExtrusionOS Enterprise.

## Recommended first automation

- Trigger: `quote_sent`
- Condition: `status equals sent`
- Action: `create_task`

Suggested action JSON:

```json
{
  "title": "Follow up with customer",
  "due_in_days": 3,
  "priority": "high",
  "notes": "Call customer and confirm decision status"
}
```

## Steps

1. Open `/automation`.
2. Click **Create rule**.
3. Enter a clear rule name.
4. Choose trigger type.
5. Add condition field, operator, and value.
6. Select an action.
7. Enter action JSON config.
8. Save rule.
9. Click **Run now** to test.
10. Keep active only after successful run logs.

## Safety notes

- Start small with one internal action.
- Prefer task/alert creation before external sends.
- Review run logs daily in early rollout.
