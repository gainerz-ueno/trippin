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
].map(([c, nation, city]) => [c, new RegExp(nation + '|' + city, 'i'), new RegExp(city, 'i')]);
export function guessCountry(area, keyword) {
  const pick = (list) => (list.length === 1 ? list[0] : '');
  const byArea = pick(CITY.filter(([, all]) => all.test(area || '')).map(([c]) => c));
  if (byArea || area) return byArea;
  return pick(CITY.filter(([, , city]) => city.test(keyword || '')).map(([c]) => c));
}

