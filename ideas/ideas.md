# Ideas

## Inline editing
Edit cycle item values directly in the list without opening a modal.

## Spending trends
Charts showing budget vs. actual spend across cycles (per category or total).

## Recurring annual expense reminders
Push notification when an annual expense installment is coming up (currently only monthly expenses have this).

## User picture
Allow the user to set a profile picture.

## Fix push notifications
Push notifications are not working. Likely caused by VAPID key rotation (DB wipe generates new keys, existing browser subscriptions become invalid and fail silently with 401 instead of 410/404). Also fix `sent_at + 'Z'` fragile date parsing and `|| 7` vs `?? 7` for warning day defaults.
