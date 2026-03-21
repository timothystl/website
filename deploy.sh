#!/bin/bash
# Timothy Lutheran Church — Deploy Script
# Run this from your local machine where wrangler can reach Cloudflare

set -e

export CLOUDFLARE_API_TOKEN="DJRxfB8HHNPpiGQagOmXg5BpOlgzccngaSKkTV49"

echo "=== Step 1: Create D1 database ==="
DB_OUTPUT=$(npx wrangler d1 create tlc-newsletter-db 2>&1)
echo "$DB_OUTPUT"

# Extract the database_id from output
DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
if [ -z "$DB_ID" ]; then
  echo ""
  echo "Could not auto-extract database_id."
  echo "Look for 'database_id = \"...\"' in the output above and paste it here:"
  read -p "database_id: " DB_ID
fi

echo ""
echo "=== Step 2: Update wrangler.toml with database_id ==="
sed -i "s/REPLACE_WITH_DATABASE_ID/$DB_ID/" wrangler.toml
echo "Updated wrangler.toml with database_id = $DB_ID"

echo ""
echo "=== Step 3: Deploy worker ==="
npx wrangler deploy

echo ""
echo "=== Step 4: Create volunteer D1 database ==="
VOL_DB_OUTPUT=$(npx wrangler d1 create tlc-volunteer-db 2>&1)
echo "$VOL_DB_OUTPUT"

VOL_DB_ID=$(echo "$VOL_DB_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
if [ -z "$VOL_DB_ID" ]; then
  # Already exists — list and grep for it
  LIST_OUTPUT=$(npx wrangler d1 list 2>&1)
  VOL_DB_ID=$(echo "$LIST_OUTPUT" | grep -i 'tlc-volunteer-db' | grep -oP '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi
if [ -z "$VOL_DB_ID" ]; then
  echo ""
  echo "Could not auto-extract volunteer database_id."
  read -p "Paste the tlc-volunteer-db database_id: " VOL_DB_ID
fi

echo ""
echo "=== Step 5: Update wrangler-volunteer.toml with database_id ==="
sed -i "s/REPLACE_WITH_VOLUNTEER_DB_ID/$VOL_DB_ID/" wrangler-volunteer.toml
echo "Updated wrangler-volunteer.toml with database_id = $VOL_DB_ID"

echo ""
echo "=== Step 6: Deploy volunteer worker ==="
npx wrangler deploy --config wrangler-volunteer.toml

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "1. Go to Cloudflare Dashboard → Workers & Pages → tlc-newsletter-admin"
echo "   Click 'Settings' → 'Triggers' → 'Add Custom Domain' → admin.timothystl.org"
echo ""
echo "2. Go to Cloudflare Dashboard → Workers & Pages → tlc-volunteer"
echo "   Click 'Settings' → 'Triggers' → 'Add Custom Domain' → volunteer.timothystl.org"
echo ""
echo "Newsletter admin: https://admin.timothystl.org"
echo "Volunteer sign-ups: https://volunteer.timothystl.org"
echo "Volunteer admin: https://volunteer.timothystl.org/admin"
echo "Password (both): 6704fyler"
