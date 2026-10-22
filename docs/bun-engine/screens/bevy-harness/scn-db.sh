source ~/bevy2/shoot-lib.sh
start_x
BEP_ROOT=$HOME/bevy2/bep $BIN home --remote --size 1280x720 >$OUT/home-db.log 2>&1 &
EPID=$!; wait_brp; sleep 2
echo "default path (BEP_ROOT):"; brp bun/status | grep -o '"home":{[^}]*}'
shot home-library-db 6
brp bun/exit >/dev/null; sleep 2
$BIN home --library /nonexistent/library.db --remote --size 1280x720 >$OUT/home-db2.log 2>&1 &
EPID=$!; wait_brp; sleep 2; brp bun/status | grep -o '"home":{[^}]*}'; shot home-library-missing 6
brp bun/exit >/dev/null; sleep 2; stop_all
