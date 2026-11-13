/** Nationalities used by the player database v1 (fictional players). */
export interface NationInfo {
  code: string;
  name: string;
  nameJa: string;
}

export const NATIONS: NationInfo[] = [
  { code: 'ARG', name: 'Argentina', nameJa: 'アルゼンチン' },
  { code: 'BRA', name: 'Brazil', nameJa: 'ブラジル' },
  { code: 'CRO', name: 'Croatia', nameJa: 'クロアチア' },
  { code: 'ENG', name: 'England', nameJa: 'イングランド' },
  { code: 'ESP', name: 'Spain', nameJa: 'スペイン' },
  { code: 'FRA', name: 'France', nameJa: 'フランス' },
  { code: 'GER', name: 'Germany', nameJa: 'ドイツ' },
  { code: 'ITA', name: 'Italy', nameJa: 'イタリア' },
  { code: 'JPN', name: 'Japan', nameJa: '日本' },
  { code: 'KOR', name: 'South Korea', nameJa: '韓国' },
  { code: 'MAR', name: 'Morocco', nameJa: 'モロッコ' },
  { code: 'NED', name: 'Netherlands', nameJa: 'オランダ' },
  { code: 'POR', name: 'Portugal', nameJa: 'ポルトガル' },
  { code: 'SWE', name: 'Sweden', nameJa: 'スウェーデン' },
  { code: 'USA', name: 'United States', nameJa: 'アメリカ' },
];

export const NATION_BY_CODE: Record<string, NationInfo> = Object.fromEntries(NATIONS.map((n) => [n.code, n]));
