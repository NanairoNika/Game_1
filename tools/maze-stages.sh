#!/bin/sh
# Grow a maze blueprint in stages (40 -> 70 -> 100 walls), best of 4 seeds per stage.
#   sh tools/maze-stages.sh <focusX> <focusY>      (coordinates are 0-based)
# Results: tools/out/stage40.txt, stage70.txt, stage100.txt
fx=$1; fy=$2; out=tools/out; mkdir -p $out
prev=""
for b in 40 70 100; do
  for s in 1 2 3 4; do
    node --experimental-strip-types tools/maze-search.ts $b $fx $fy 400000 $s $prev 2>/dev/null > $out/s${b}_$s.txt
  done
  best=$(for f in $out/s${b}_*.txt; do echo "$(head -1 $f | sed 's/.*"score":\([0-9]*\).*/\1/') $f"; done | sort -rn | head -1 | cut -d' ' -f2)
  cp $best $out/stage$b.txt
  prev=$out/stage$b.txt
  head -1 $out/stage$b.txt
done
cat $out/stage100.txt
