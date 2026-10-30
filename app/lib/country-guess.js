// 地名から国を当てる（サーバーと画面の両方で使う。鍵やGoogleへの問い合わせは入れない）
// 国を選んでいないとき、地名から国を当てる（当たればGoogleへの検索は1回で済む）
// ・「場所」の欄：国名も街の名前も使う
// ・「キーワード」の欄：街の名前だけ（「韓国料理」「タイ料理」のような料理名で国を決めつけないため）
const CITY = [
  ['TW', '台湾|臺灣|Taiwan', '台北|臺北|台中|臺中|台南|臺南|高雄|九份|淡水|士林|西門|永康街|花蓮|基隆|新北|桃園|宜蘭|墾丁|日月潭|阿里山|Taipei|Kaohsiung|Tainan|Taichung'],
  ['KR', '韓国|Korea', 'ソウル|釜山|明洞|弘大|江南|東大門|仁川|済州|景福宮|梨泰院|Seoul|Busan'],
  ['HK', '香港|Hong ?Kong', '九龍|尖沙咀|旺角|銅鑼湾|中環|Kowloon'],
  ['VN', 'ベトナム|Vietnam|Viet Nam', 'ホーチミン|ハノイ|ダナン|ホイアン|フエ|ニャチャン|フーコック|Ho Chi Minh|Hanoi|Da ?Nang|Hoi An'],
  ['TH', 'タイ|Thailand', 'バンコク|プーケット|チェンマイ|パタヤ|アユタヤ|Bangkok|Phuket|Chiang ?Mai'],
  ['SG', 'シンガポール|Singapore', 'シンガポール|Singapore'],
  ['MY', 'マレーシア|Malaysia', 'クアラルンプール|ペナン|コタキナバル|ランカウイ|Kuala Lumpur|Penang'],
  ['PH', 'フィリピン|Philippines', 'マニラ|セブ|ボラカイ|Manila|Cebu'],
  ['CN', '中国|China', '上海|北京|広州|深圳|成都|西安|杭州|Shanghai|Beijing'],
  ['JP', '日本|Japan', '北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|札幌|小樽|函館|仙台|横浜|鎌倉|箱根|名古屋|金沢|神戸|博多|天神|那覇|石垣|宮古島|渋谷|新宿|銀座|浅草|池袋|上野|原宿|表参道|六本木|秋葉原|吉祥寺|梅田|難波|なんば|心斎橋|道頓堀|天王寺|三宮|祇園|嵐山|伊勢|軽井沢|熱海|別府|由布院|湯布院|姫路|尼崎|西宮|芦屋|川西|宝塚|伊丹'],
].map(([c, nation, city]) => [c, new RegExp(nation + '|' + city, 'i'), new RegExp(city, 'i')]);
export function guessCountry(area, keyword) {
  const pick = (list) => (list.length === 1 ? list[0] : '');
  const byArea = pick(CITY.filter(([, all]) => all.test(area || '')).map(([c]) => c));
  if (byArea || area) return byArea;
  return pick(CITY.filter(([, , city]) => city.test(keyword || '')).map(([c]) => c));
}

