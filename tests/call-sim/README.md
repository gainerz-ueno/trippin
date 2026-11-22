# タビビコールの電話の流れの通し試験（電話をかけない・お金がかからない）

本物の電話の仕組み（cloudflare/call.js）に、Twilio の知らせ（AIが話し始めた/終わった、お店が話し始めた/終わった、文字）を時間どおりに流し、
お店の返事のいろいろな場面（想定問答）で、最後まで正しく進むか・止まらないか（いちばん長い間が10秒以内）を確かめる。AIの返事は fake-server.mjs の作り物。

    cd tests/call-sim && sed -e "s#'../app/lib/call.js'#'$(pwd)/../../app/lib/call.js'#" -e "s#'../app/lib/call-server.js'#'./fake-server.mjs'#" ../../cloudflare/call.js > call.mjs && node cases.mjs

場面を足すときは cases.mjs に1行足す。社長の電話で崩れた場面は、必ずここに足してから直す（2026-11-22 社長「答えうる想定の部分を全部用意するんじゃないの」）。
