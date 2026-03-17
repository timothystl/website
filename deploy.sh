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
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "1. Go to Cloudflare Dashboard → Workers & Pages → tlc-newsletter-admin"
echo "2. Click 'Settings' → 'Triggers' → 'Add Custom Domain'"
echo "3. Enter: admin.timothystl.org"
echo "   (timothystl.org must be on Cloudflare for this to work)"
echo ""
echo "Your admin panel will be live at: https://admin.timothystl.org"
echo "Password: 6704fyler"
