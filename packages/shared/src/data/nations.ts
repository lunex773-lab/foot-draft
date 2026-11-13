/**
 * Nationalities used for fictional players.
 *
 * Player names are random combinations of common given names and family
 * names for each nation. They are fictional and do not represent real
 * people (spec 4-6). Well-known surnames of famous footballers are avoided.
 */
export interface NationInfo {
  code: string;
  name: string;
  nameJa: string;
  /** relative weight when generating players */
  weight: number;
  /** skin tone distribution (6 tones, light -> dark) */
  skin: [number, number, number, number, number, number];
  /** hair color distribution (black, dark brown, brown, light brown, blond, red) */
  hair: [number, number, number, number, number, number];
  firstNames: string[];
  lastNames: string[];
}

const EU: NationInfo['skin'] = [0.26, 0.3, 0.2, 0.12, 0.07, 0.05];
const NORDIC: NationInfo['skin'] = [0.42, 0.3, 0.12, 0.08, 0.05, 0.03];
const WEST_AFRICA: NationInfo['skin'] = [0, 0, 0.04, 0.2, 0.4, 0.36];
const EU_HAIR: NationInfo['hair'] = [0.18, 0.34, 0.24, 0.12, 0.09, 0.03];
const NORDIC_HAIR: NationInfo['hair'] = [0.05, 0.18, 0.24, 0.23, 0.26, 0.04];
const DARK_HAIR: NationInfo['hair'] = [0.7, 0.26, 0.04, 0, 0, 0];
const LATIN_HAIR: NationInfo['hair'] = [0.4, 0.38, 0.16, 0.04, 0.02, 0];

export const NATIONS: NationInfo[] = [
  {
    code: 'ENG',
    name: 'England',
    nameJa: 'イングランド',
    weight: 14,
    skin: [0.3, 0.28, 0.16, 0.12, 0.08, 0.06],
    hair: EU_HAIR,
    firstNames: ['Oliver', 'George', 'Callum', 'Ethan', 'Lewis', 'Owen', 'Ryan', 'Jamie', 'Connor', 'Samuel', 'Nathan', 'Reece', 'Toby', 'Alfie', 'Jacob', 'Elliot'],
    lastNames: ['Ashford', 'Whitmore', 'Hollins', 'Bramley', 'Thornton', 'Pickering', 'Cartwright', 'Kendall', 'Fairbrook', 'Langley', 'Pemberton', 'Radcliffe', 'Stanton', 'Wexley', 'Calloway', 'Marston', 'Draycott', 'Hawthorne', 'Ellery', 'Kingsley', 'Ashcroft', 'Fenwick'],
  },
  {
    code: 'ESP',
    name: 'Spain',
    nameJa: 'スペイン',
    weight: 14,
    skin: [0.18, 0.36, 0.28, 0.1, 0.05, 0.03],
    hair: LATIN_HAIR,
    firstNames: ['Alejandro', 'Pablo', 'Diego', 'Javier', 'Marcos', 'Adrián', 'Hugo', 'Álvaro', 'Iker', 'Rubén', 'Mario', 'Gonzalo', 'Unai', 'Aitor', 'Nicolás', 'Óscar'],
    lastNames: ['Navarro', 'Herrera', 'Molina', 'Castaño', 'Ibarra', 'Serrano', 'Rivas', 'Montoya', 'Ortega', 'Delgado', 'Beltrán', 'Cabrera', 'Salcedo', 'Arroyo', 'Peñalver', 'Quintana', 'Aguado', 'Escudero', 'Lozano', 'Carmona', 'Robledo', 'Zabala'],
  },
  {
    code: 'FRA',
    name: 'France',
    nameJa: 'フランス',
    weight: 14,
    skin: [0.22, 0.24, 0.16, 0.14, 0.13, 0.11],
    hair: [0.3, 0.32, 0.2, 0.1, 0.06, 0.02],
    firstNames: ['Lucas', 'Théo', 'Maxime', 'Antoine', 'Julien', 'Baptiste', 'Mathis', 'Clément', 'Raphaël', 'Louis', 'Enzo', 'Bastien', 'Yanis', 'Noah', 'Ismaël', 'Moussa', 'Mateo'],
    lastNames: ['Lefèvre', 'Moreau', 'Girard', 'Fontaine', 'Rousseau', 'Chevalier', 'Mercier', 'Dupuis', 'Lambert', 'Garnier', 'Faure', 'Marchand', 'Perrin', 'Renaud', 'Brunet', 'Blanchard', 'Delacroix', 'Carpentier', 'Vasseur', 'Diallo', 'Traoré', 'Silva'],
  },
  {
    code: 'GER',
    name: 'Germany',
    nameJa: 'ドイツ',
    weight: 14,
    skin: [0.34, 0.3, 0.16, 0.1, 0.06, 0.04],
    hair: [0.12, 0.32, 0.26, 0.15, 0.13, 0.02],
    firstNames: ['Lukas', 'Jonas', 'Leon', 'Finn', 'Felix', 'Maximilian', 'Niklas', 'Jannik', 'Moritz', 'Tobias', 'Elias', 'Florian', 'Matthias', 'Adrian', 'Konstantin', 'Malte'],
    lastNames: ['Krüger', 'Hoffmann', 'Vogel', 'Becker', 'Schröder', 'Hartmann', 'Keller', 'Fischer', 'Ziegler', 'Engel', 'Brenner', 'Albrecht', 'Kessler', 'Seidel', 'Winkler', 'Roth', 'Baumann', 'Kranz', 'Volkov', 'Lindner', 'Pohl', 'Sauer'],
  },
  {
    code: 'ITA',
    name: 'Italy',
    nameJa: 'イタリア',
    weight: 14,
    skin: [0.2, 0.36, 0.28, 0.1, 0.04, 0.02],
    hair: LATIN_HAIR,
    firstNames: ['Luca', 'Marco', 'Matteo', 'Alessandro', 'Lorenzo', 'Davide', 'Federico', 'Simone', 'Riccardo', 'Stefano', 'Gabriele', 'Tommaso', 'Nicolò', 'Pietro', 'Filippo', 'Edoardo'],
    lastNames: ['Moretti', 'Ricci', 'Colombo', 'Mancuso', 'Galli', 'Ferraro', 'Bellini', 'Conti', 'Marchetti', 'Lombardi', 'Testa', 'Fabbri', 'Gentile', 'Santoro', 'Rinaldi', 'Caruso', 'Morelli', 'Vitale', 'Pellegrini', 'Serra', 'Fontana', 'Guidi'],
  },
  {
    code: 'NED',
    name: 'Netherlands',
    nameJa: 'オランダ',
    weight: 10,
    skin: [0.34, 0.26, 0.14, 0.12, 0.08, 0.06],
    hair: NORDIC_HAIR,
    firstNames: ['Daan', 'Sem', 'Bram', 'Jesse', 'Thijs', 'Ruben', 'Lars', 'Joost', 'Stijn', 'Milan', 'Niels', 'Tijn', 'Jayden', 'Rick'],
    lastNames: ['de Vries', 'Bakker', 'Visser', 'Smit', 'Mulder', 'Bos', 'Vos', 'Dekker', 'Brouwer', 'van Dam', 'Kuipers', 'Hendriks', 'Veenstra', 'Postma', 'van Leeuwen', 'Kramer', 'Schouten', 'Verhoeven'],
  },
  {
    code: 'BEL',
    name: 'Belgium',
    nameJa: 'ベルギー',
    weight: 8,
    skin: [0.28, 0.28, 0.16, 0.12, 0.09, 0.07],
    hair: EU_HAIR,
    firstNames: ['Arthur', 'Louis', 'Jules', 'Victor', 'Wout', 'Senne', 'Arno', 'Mathéo', 'Kobe', 'Warre', 'Lucien', 'Noah'],
    lastNames: ['Peeters', 'Claes', 'Wouters', 'Goossens', 'Maes', 'Janssens', 'Lemaire', 'Dubois', 'Michiels', 'Verbeke', 'Desmet', 'Coppens', 'Lambrecht', 'Vandamme', 'Hermans', 'Segers'],
  },
  {
    code: 'EST',
    name: 'Estonia',
    nameJa: 'エストニア',
    weight: 3,
    skin: NORDIC,
    hair: NORDIC_HAIR,
    firstNames: ['Elias', 'Rasmus', 'Kristjan', 'Markus', 'Siim', 'Karl', 'Oskar', 'Mihkel', 'Rainer', 'Henri'],
    lastNames: ['Voss', 'Tamm', 'Saar', 'Kask', 'Ilves', 'Lepik', 'Rebane', 'Mägi', 'Koppel', 'Pärn', 'Kukk', 'Sepp'],
  },
  {
    code: 'JPN',
    name: 'Japan',
    nameJa: '日本',
    weight: 10,
    skin: [0.24, 0.5, 0.22, 0.04, 0, 0],
    hair: DARK_HAIR,
    firstNames: ['Haruto', 'Sota', 'Yuto', 'Riku', 'Kaito', 'Ren', 'Hayato', 'Daiki', 'Shota', 'Kenta', 'Yamato', 'Takumi', 'Ryusei', 'Kosei', 'Itsuki', 'Asahi'],
    lastNames: ['Takeda', 'Morikawa', 'Hoshino', 'Kurosawa', 'Fujimoto', 'Aoyama', 'Shimizu', 'Kagawa', 'Nishimura', 'Ishikawa', 'Murata', 'Hirano', 'Sakamoto', 'Tsuchiya', 'Kamiya', 'Okada', 'Miyazaki', 'Hasegawa', 'Uchida', 'Yoshikawa'],
  },
  {
    code: 'ARG',
    name: 'Argentina',
    nameJa: 'アルゼンチン',
    weight: 12,
    skin: [0.26, 0.36, 0.26, 0.09, 0.03, 0],
    hair: LATIN_HAIR,
    firstNames: ['Santiago', 'Facundo', 'Joaquín', 'Tomás', 'Franco', 'Matías', 'Agustín', 'Bautista', 'Lautaro', 'Valentín', 'Ignacio', 'Thiago', 'Emiliano', 'Bruno'],
    lastNames: ['Acosta', 'Benítez', 'Sosa', 'Medina', 'Ríos', 'Ojeda', 'Figueroa', 'Godoy', 'Luna', 'Ferreyra', 'Correa', 'Villalba', 'Ledesma', 'Quiroga', 'Arce', 'Montenegro', 'Paredes', 'Bustos'],
  },
  {
    code: 'BRA',
    name: 'Brazil',
    nameJa: 'ブラジル',
    weight: 14,
    skin: [0.12, 0.18, 0.2, 0.2, 0.17, 0.13],
    hair: DARK_HAIR,
    firstNames: ['Gabriel', 'Lucas', 'Matheus', 'Rafael', 'Felipe', 'Gustavo', 'Thiago', 'Vinícius', 'Caio', 'Diogo', 'Igor', 'Murilo', 'Renan', 'Wesley', 'Danilo', 'Éder', 'Mateo'],
    lastNames: ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Freitas', 'Gomes', 'Lacerda', 'Moraes', 'Nogueira', 'Pacheco', 'Queiroz', 'Rezende', 'Teixeira', 'Vasconcelos', 'Siqueira', 'Bezerra', 'Campos', 'Silva', 'Dantas'],
  },
  {
    code: 'NGA',
    name: 'Nigeria',
    nameJa: 'ナイジェリア',
    weight: 8,
    skin: WEST_AFRICA,
    hair: [0.92, 0.08, 0, 0, 0, 0],
    firstNames: ['Chukwuemeka', 'Tobi', 'Femi', 'Kelechi', 'Ifeanyi', 'Tunde', 'Obinna', 'Segun', 'Emeka', 'Dayo', 'Chidi', 'Uche', 'Kunle'],
    lastNames: ['Okafor', 'Adeyemi', 'Nwosu', 'Balogun', 'Eze', 'Okonkwo', 'Afolabi', 'Chukwu', 'Olatunji', 'Uzor', 'Adebayo', 'Obi', 'Ogunleye', 'Ibekwe', 'Nnamdi'],
  },
  {
    code: 'SEN',
    name: 'Senegal',
    nameJa: 'セネガル',
    weight: 6,
    skin: WEST_AFRICA,
    hair: [0.92, 0.08, 0, 0, 0, 0],
    firstNames: ['Abdou', 'Cheikh', 'Pape', 'Ousmane', 'Mamadou', 'Ibrahima', 'Lamine', 'Moussa', 'Babacar', 'Alioune', 'Saliou'],
    lastNames: ['Ndiaye', 'Diop', 'Faye', 'Sow', 'Gueye', 'Sarr', 'Ba', 'Thiam', 'Seck', 'Dieng', 'Ndour', 'Fall', 'Cissé'],
  },
  {
    code: 'CIV',
    name: "Côte d'Ivoire",
    nameJa: 'コートジボワール',
    weight: 6,
    skin: WEST_AFRICA,
    hair: [0.92, 0.08, 0, 0, 0, 0],
    firstNames: ['Serge', 'Wilfried', 'Franck', 'Christian', 'Aboubacar', 'Jean-Paul', 'Arsène', 'Hervé', 'Didier', 'Koffi', 'Junior'],
    lastNames: ['Kouassi', 'Konan', 'Yao', "N'Guessan", 'Bamba', 'Koné', 'Ouattara', 'Gbagbo', 'Kouadio', 'Tanoh', 'Aké', 'Zadi'],
  },
  {
    code: 'GHA',
    name: 'Ghana',
    nameJa: 'ガーナ',
    weight: 6,
    skin: WEST_AFRICA,
    hair: [0.92, 0.08, 0, 0, 0, 0],
    firstNames: ['Kwame', 'Kofi', 'Yaw', 'Kwabena', 'Kojo', 'Nana', 'Ebo', 'Kwesi', 'Fiifi', 'Samuel', 'Isaac'],
    lastNames: ['Mensah', 'Owusu', 'Asante', 'Boateng', 'Osei', 'Appiah', 'Darko', 'Ofori', 'Amankwah', 'Frimpong', 'Tetteh', 'Quaye'],
  },
  {
    code: 'MAR',
    name: 'Morocco',
    nameJa: 'モロッコ',
    weight: 6,
    skin: [0.06, 0.22, 0.38, 0.24, 0.07, 0.03],
    hair: DARK_HAIR,
    firstNames: ['Youssef', 'Amine', 'Hamza', 'Ilyas', 'Karim', 'Mehdi', 'Anass', 'Soufiane', 'Rayane', 'Zakaria', 'Bilal', 'Adil'],
    lastNames: ['El Amrani', 'Benali', 'Tazi', 'Chraibi', 'El Idrissi', 'Bennani', 'Lahlou', 'Ouazzani', 'Berrada', 'Alaoui', 'Fassi', 'Haddad'],
  },
  {
    code: 'COL',
    name: 'Colombia',
    nameJa: 'コロンビア',
    weight: 8,
    skin: [0.1, 0.24, 0.3, 0.2, 0.1, 0.06],
    hair: DARK_HAIR,
    firstNames: ['Juan', 'Andrés', 'Sebastián', 'Camilo', 'Felipe', 'Esteban', 'Jhon', 'Duván', 'Yerson', 'Santiago', 'Mateo', 'Brayan'],
    lastNames: ['Restrepo', 'Ospina', 'Mosquera', 'Cuadrado', 'Valencia', 'Zapata', 'Arango', 'Londoño', 'Palacios', 'Murillo', 'Uribe', 'Cárdenas', 'Henao', 'Vélez'],
  },
  {
    code: 'SWE',
    name: 'Sweden',
    nameJa: 'スウェーデン',
    weight: 6,
    skin: NORDIC,
    hair: NORDIC_HAIR,
    firstNames: ['Erik', 'Viktor', 'Gustav', 'Linus', 'Oscar', 'Emil', 'Albin', 'Hugo', 'Isak', 'Melker', 'Anton', 'Axel'],
    lastNames: ['Lindqvist', 'Bergström', 'Holm', 'Sjöberg', 'Nyberg', 'Ekström', 'Lundgren', 'Wallin', 'Forsberg', 'Hedlund', 'Åkesson', 'Sandberg'],
  },
  {
    code: 'DEN',
    name: 'Denmark',
    nameJa: 'デンマーク',
    weight: 6,
    skin: NORDIC,
    hair: NORDIC_HAIR,
    firstNames: ['Mads', 'Rasmus', 'Mikkel', 'Frederik', 'Magnus', 'Kasper', 'Jonas', 'Mathias', 'Søren', 'Anders', 'Villads'],
    lastNames: ['Nørgaard', 'Kjær', 'Lauridsen', 'Dalsgaard', 'Holst', 'Bach', 'Vestergaard', 'Thomsen', 'Kristoffersen', 'Juhl', 'Skov', 'Bruun'],
  },
  {
    code: 'NOR',
    name: 'Norway',
    nameJa: 'ノルウェー',
    weight: 6,
    skin: NORDIC,
    hair: NORDIC_HAIR,
    firstNames: ['Sindre', 'Eirik', 'Håkon', 'Sander', 'Tobias', 'Vegard', 'Even', 'Torbjørn', 'Martin', 'Aksel', 'Henrik'],
    lastNames: ['Haugen', 'Berg', 'Solberg', 'Strand', 'Lie', 'Bakken', 'Moen', 'Dahl', 'Aas', 'Eide', 'Lunde', 'Rønning'],
  },
  {
    code: 'IRL',
    name: 'Ireland',
    nameJa: 'アイルランド',
    weight: 5,
    skin: [0.5, 0.28, 0.1, 0.06, 0.04, 0.02],
    hair: [0.1, 0.3, 0.24, 0.12, 0.1, 0.14],
    firstNames: ['Seán', 'Cian', 'Darragh', 'Oisín', 'Conor', 'Eoin', 'Ciarán', 'Liam', 'Tadhg', 'Rory', 'Fionn'],
    lastNames: ["O'Brien", 'Byrne', 'Kavanagh', 'Doyle', 'Brennan', 'Gallagher', 'Moran', 'Flanagan', 'Duggan', 'Kearney', "O'Sullivan", 'Quinlan'],
  },
  {
    code: 'POL',
    name: 'Poland',
    nameJa: 'ポーランド',
    weight: 6,
    skin: [0.42, 0.32, 0.14, 0.06, 0.04, 0.02],
    hair: [0.08, 0.3, 0.28, 0.18, 0.14, 0.02],
    firstNames: ['Jakub', 'Kacper', 'Szymon', 'Mateusz', 'Bartosz', 'Piotr', 'Michał', 'Wojciech', 'Kamil', 'Dawid', 'Patryk'],
    lastNames: ['Nowicki', 'Zieliński', 'Kowalczyk', 'Wiśniewski', 'Mazur', 'Krawczyk', 'Dąbrowski', 'Pawlak', 'Sikora', 'Wróbel', 'Jabłoński', 'Kaczmarek'],
  },
  {
    code: 'AUT',
    name: 'Austria',
    nameJa: 'オーストリア',
    weight: 5,
    skin: EU,
    hair: EU_HAIR,
    firstNames: ['Florian', 'Stefan', 'Lukas', 'Dominik', 'Patrick', 'Valentin', 'Raphael', 'Fabian', 'Christoph', 'Johannes', 'Marcel'],
    lastNames: ['Gruber', 'Huber', 'Pichler', 'Steiner', 'Moser', 'Hofer', 'Leitner', 'Eder', 'Mayrhofer', 'Wimmer', 'Aigner', 'Brunner'],
  },
];

export const NATION_BY_CODE: Record<string, NationInfo> = Object.fromEntries(NATIONS.map((n) => [n.code, n]));
