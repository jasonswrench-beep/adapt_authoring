#!/bin/sh
# Prints everything needed to diagnose the server in one go, so it can be pasted back in a single message.
# Run on the server from the repository folder:   sh scripts/diagnose.sh
# It never prints passwords: the .env file is not shown.
cd "$(dirname "$0")/.." || exit 1
echo "=== version ==="; git log --oneline -1
echo "=== containers ==="; docker compose ps
echo "=== last 40 log lines ==="; docker compose logs --tail=40 adapt 2>&1 | cut -c1-220
echo "=== installed plugins (count) ==="; docker compose exec -T adapt sh -c 'ls /app/temp/*/adapt_framework/src/components /app/temp/*/adapt_framework/src/extensions 2>/dev/null | grep -c adapt' 2>&1
echo "=== accessibility checker on the newest course build ==="
docker compose exec -T adapt sh -c 'B=$(ls -dt /app/temp/*/adapt_framework/courses/*/*/build 2>/dev/null | head -1); echo "folder: $B"; [ -n "$B" ] && cd /app/scripts/a11y-check && node a11y-check.js "$B" --fail-on never 2>&1 | cut -c1-400' 2>&1
echo "=== newest course build: files and settings ==="
docker compose exec -T adapt sh -c 'B=$(ls -dt /app/temp/*/adapt_framework/courses/*/*/build 2>/dev/null | head -1); echo "built: $(stat -c %y "$B" | cut -c1-19)"; echo "-- adapt/css:"; ls -la "$B/adapt/css" 2>&1 | tail -5; echo "-- stylesheet links in index.html:"; grep -o "<link[^>]*>" "$B/index.html" | head -5; echo "-- config.json keys:"; node -e "const c=require(process.argv[1]);console.log(Object.keys(c).join(\", \"));console.log(\"theme:\",c._theme,\"menu:\",c._menu,\"screenSize:\",JSON.stringify(c.screenSize))" "$B/course/config.json" 2>&1' 2>&1
echo "=== build problems in the log (last 400 lines) ==="
docker compose logs --tail=400 adapt 2>&1 | grep -iE "fatal|error|aborted|screenSize|less|theme" | grep -v "Warning: Accessing non-existent" | tail -15 | cut -c1-260
echo "=== courses: theme and menu (what each course is built with) ==="
docker compose exec -T mongo mongosh adapt-tenant-master --quiet <<'JS' 2>&1 | cut -c1-200
const titles = {};
db.courses.find({}, { title: 1 }).forEach(c => { titles[c._id.str] = c.title; });
db.configs.find().forEach(c => print((titles[c._courseId.str] || c._courseId) + '  |  theme=' + c._theme + '  |  menu=' + c._menu + '  |  preset=' + c._themePreset));
JS
echo "=== Slides components: how many slides each holds ==="
docker compose exec -T mongo mongosh adapt-tenant-master --quiet <<'JS' 2>&1 | cut -c1-200
const titles = {};
db.courses.find({}, { title: 1 }).forEach(c => { titles[c._id.str] = c.title; });
db.components.find({ _component: 'slides' }).forEach(c => print((titles[c._courseId.str] || c._courseId) + ': ' + (((c.properties || {})._items || []).length) + ' slide(s)'));
JS
echo "=== disk and memory ==="; df -h / | tail -1; free -m | sed -n 2p
echo "=== end ==="
