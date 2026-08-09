// 47都道府県の「タイルグリッドマップ」レイアウト。
// 各県を同じ大きさのマスにして地理配置を模して並べる(北海道=右上, 沖縄=左下)。
// row/col は 0 始まり。GRID_ROWS×GRID_COLS の CSS Grid 上に配置する。
// name は data 側の県名(接尾辞つきフルネーム)と完全一致させ、集計値の突き合わせキーにする。
// short は 2 字の表示ラベル(数字を主役にしマス幅を揃えるため)。

export interface PrefTile {
  name: string
  short: string
  row: number
  col: number
}

export const GRID_ROWS = 12
export const GRID_COLS = 13

export const PREF_TILES: PrefTile[] = [
  // 北海道
  { name: '北海道', short: '北海', row: 0, col: 11 },
  // 東北
  { name: '青森県', short: '青森', row: 1, col: 11 },
  { name: '秋田県', short: '秋田', row: 2, col: 10 },
  { name: '岩手県', short: '岩手', row: 2, col: 11 },
  { name: '山形県', short: '山形', row: 3, col: 10 },
  { name: '宮城県', short: '宮城', row: 3, col: 11 },
  { name: '新潟県', short: '新潟', row: 4, col: 10 },
  { name: '福島県', short: '福島', row: 4, col: 11 },
  // 北陸・甲信・関東
  { name: '石川県', short: '石川', row: 5, col: 8 },
  { name: '富山県', short: '富山', row: 5, col: 9 },
  { name: '群馬県', short: '群馬', row: 5, col: 10 },
  { name: '栃木県', short: '栃木', row: 5, col: 11 },
  { name: '茨城県', short: '茨城', row: 5, col: 12 },
  { name: '福井県', short: '福井', row: 6, col: 8 },
  { name: '長野県', short: '長野', row: 6, col: 9 },
  { name: '埼玉県', short: '埼玉', row: 6, col: 10 },
  { name: '東京都', short: '東京', row: 6, col: 11 },
  { name: '千葉県', short: '千葉', row: 6, col: 12 },
  // 山陰・近畿北・中部・関東南
  { name: '島根県', short: '島根', row: 7, col: 5 },
  { name: '鳥取県', short: '鳥取', row: 7, col: 6 },
  { name: '京都府', short: '京都', row: 7, col: 7 },
  { name: '滋賀県', short: '滋賀', row: 7, col: 8 },
  { name: '岐阜県', short: '岐阜', row: 7, col: 9 },
  { name: '山梨県', short: '山梨', row: 7, col: 10 },
  { name: '神奈川県', short: '神奈', row: 7, col: 11 },
  // 近畿・東海
  { name: '兵庫県', short: '兵庫', row: 8, col: 6 },
  { name: '大阪府', short: '大阪', row: 8, col: 7 },
  { name: '奈良県', short: '奈良', row: 8, col: 8 },
  { name: '三重県', short: '三重', row: 8, col: 9 },
  { name: '愛知県', short: '愛知', row: 8, col: 10 },
  { name: '静岡県', short: '静岡', row: 8, col: 11 },
  // 九州北・中国南・近畿南
  { name: '福岡県', short: '福岡', row: 9, col: 3 },
  { name: '山口県', short: '山口', row: 9, col: 4 },
  { name: '広島県', short: '広島', row: 9, col: 5 },
  { name: '岡山県', short: '岡山', row: 9, col: 6 },
  { name: '和歌山県', short: '和歌', row: 9, col: 7 },
  // 九州中・四国北
  { name: '長崎県', short: '長崎', row: 10, col: 1 },
  { name: '佐賀県', short: '佐賀', row: 10, col: 2 },
  { name: '熊本県', short: '熊本', row: 10, col: 3 },
  { name: '大分県', short: '大分', row: 10, col: 4 },
  { name: '香川県', short: '香川', row: 10, col: 6 },
  { name: '徳島県', short: '徳島', row: 10, col: 7 },
  // 沖縄・九州南・四国南
  { name: '沖縄県', short: '沖縄', row: 11, col: 0 },
  { name: '鹿児島県', short: '鹿児', row: 11, col: 2 },
  { name: '宮崎県', short: '宮崎', row: 11, col: 3 },
  { name: '愛媛県', short: '愛媛', row: 11, col: 5 },
  { name: '高知県', short: '高知', row: 11, col: 6 },
]

export const PREF_NAME_SET = new Set(PREF_TILES.map((t) => t.name))
