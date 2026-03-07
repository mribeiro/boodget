#!/bin/sh
# Reset a user's password inside the Docker container.
# Usage:
#   docker exec -it <container_name> /app/scripts/reset-password.sh <username> <new-password>
#
# The new password must be at least 16 characters and include uppercase letters,
# lowercase letters, numbers, and symbols.

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <username> <new-password>"
  exit 1
fi

USERNAME="$1"
NEW_PASSWORD="$2"

node /app/scripts/reset-password.js "$USERNAME" "$NEW_PASSWORD"
