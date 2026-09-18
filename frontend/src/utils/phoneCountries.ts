export interface PhoneCountry {
  iso: string;
  name: string;
  callingCode: string;
}

// ISO 3166-1 alpha-2 + calling codes. Countries sharing a calling code remain
// separate so the user can identify the destination by its flag and name.
const COUNTRY_DATA = `AF|Afeganistão|93;AL|Albânia|355;DZ|Argélia|213;AS|Samoa Americana|1684;AD|Andorra|376;AO|Angola|244;AI|Anguila|1264;AQ|Antártida|672;AG|Antígua e Barbuda|1268;AR|Argentina|54;AM|Armênia|374;AW|Aruba|297;AU|Austrália|61;AT|Áustria|43;AZ|Azerbaijão|994;BS|Bahamas|1242;BH|Bahrein|973;BD|Bangladesh|880;BB|Barbados|1246;BY|Belarus|375;BE|Bélgica|32;BZ|Belize|501;BJ|Benim|229;BM|Bermudas|1441;BT|Butão|975;BO|Bolívia|591;BQ|Bonaire, Santo Eustáquio e Saba|599;BA|Bósnia e Herzegovina|387;BW|Botsuana|267;BV|Ilha Bouvet|47;BR|Brasil|55;IO|Território Britânico do Oceano Índico|246;BN|Brunei|673;BG|Bulgária|359;BF|Burquina Faso|226;BI|Burundi|257;CV|Cabo Verde|238;KH|Camboja|855;CM|Camarões|237;CA|Canadá|1;KY|Ilhas Cayman|1345;CF|República Centro-Africana|236;TD|Chade|235;CL|Chile|56;CN|China|86;CX|Ilha Christmas|61;CC|Ilhas Cocos|61;CO|Colômbia|57;KM|Comores|269;CG|Congo|242;CD|Congo, República Democrática|243;CK|Ilhas Cook|682;CR|Costa Rica|506;CI|Costa do Marfim|225;HR|Croácia|385;CU|Cuba|53;CW|Curaçau|599;CY|Chipre|357;CZ|Tchéquia|420;DK|Dinamarca|45;DJ|Djibuti|253;DM|Dominica|1767;DO|República Dominicana|1809;EC|Equador|593;EG|Egito|20;SV|El Salvador|503;GQ|Guiné Equatorial|240;ER|Eritreia|291;EE|Estônia|372;SZ|Essuatíni|268;ET|Etiópia|251;FK|Ilhas Malvinas|500;FO|Ilhas Faroé|298;FJ|Fiji|679;FI|Finlândia|358;FR|França|33;GF|Guiana Francesa|594;PF|Polinésia Francesa|689;TF|Terras Austrais e Antárticas Francesas|262;GA|Gabão|241;GM|Gâmbia|220;GE|Geórgia|995;DE|Alemanha|49;GH|Gana|233;GI|Gibraltar|350;GR|Grécia|30;GL|Groenlândia|299;GD|Granada|1473;GP|Guadalupe|590;GU|Guam|1671;GT|Guatemala|502;GG|Guernsey|44;GN|Guiné|224;GW|Guiné-Bissau|245;GY|Guiana|592;HT|Haiti|509;HM|Ilha Heard e Ilhas McDonald|672;VA|Vaticano|39;HN|Honduras|504;HK|Hong Kong|852;HU|Hungria|36;IS|Islândia|354;IN|Índia|91;ID|Indonésia|62;IR|Irã|98;IQ|Iraque|964;IE|Irlanda|353;IM|Ilha de Man|44;IL|Israel|972;IT|Itália|39;JM|Jamaica|1876;JP|Japão|81;JE|Jersey|44;JO|Jordânia|962;KZ|Cazaquistão|7;KE|Quênia|254;KI|Kiribati|686;KP|Coreia do Norte|850;KR|Coreia do Sul|82;KW|Kuwait|965;KG|Quirguistão|996;LA|Laos|856;LV|Letônia|371;LB|Líbano|961;LS|Lesoto|266;LR|Libéria|231;LY|Líbia|218;LI|Liechtenstein|423;LT|Lituânia|370;LU|Luxemburgo|352;MO|Macau|853;MG|Madagascar|261;MW|Malawi|265;MY|Malásia|60;MV|Maldivas|960;ML|Mali|223;MT|Malta|356;MH|Ilhas Marshall|692;MQ|Martinica|596;MR|Mauritânia|222;MU|Maurício|230;YT|Mayotte|262;MX|México|52;FM|Micronésia|691;MD|Moldávia|373;MC|Mônaco|377;MN|Mongólia|976;ME|Montenegro|382;MS|Montserrat|1664;MA|Marrocos|212;MZ|Moçambique|258;MM|Mianmar|95;NA|Namíbia|264;NR|Nauru|674;NP|Nepal|977;NL|Países Baixos|31;NC|Nova Caledônia|687;NZ|Nova Zelândia|64;NI|Nicarágua|505;NE|Níger|227;NG|Nigéria|234;NU|Niue|683;NF|Ilha Norfolk|672;MK|Macedônia do Norte|389;MP|Ilhas Marianas do Norte|1670;NO|Noruega|47;OM|Omã|968;PK|Paquistão|92;PW|Palau|680;PS|Palestina|970;PA|Panamá|507;PG|Papua-Nova Guiné|675;PY|Paraguai|595;PE|Peru|51;PH|Filipinas|63;PN|Pitcairn|64;PL|Polônia|48;PT|Portugal|351;PR|Porto Rico|1787;QA|Catar|974;RE|Reunião|262;RO|Romênia|40;RU|Rússia|7;RW|Ruanda|250;BL|São Bartolomeu|590;SH|Santa Helena|290;KN|São Cristóvão e Névis|1869;LC|Santa Lúcia|1758;MF|São Martinho|590;PM|São Pedro e Miquelão|508;VC|São Vicente e Granadinas|1784;WS|Samoa|685;SM|San Marino|378;ST|São Tomé e Príncipe|239;SA|Arábia Saudita|966;SN|Senegal|221;RS|Sérvia|381;SC|Seicheles|248;SL|Serra Leoa|232;SG|Singapura|65;SX|São Martinho|1721;SK|Eslováquia|421;SI|Eslovênia|386;SB|Ilhas Salomão|677;SO|Somália|252;ZA|África do Sul|27;GS|Geórgia do Sul e Sandwich do Sul|500;SS|Sudão do Sul|211;ES|Espanha|34;LK|Sri Lanka|94;SD|Sudão|249;SR|Suriname|597;SJ|Svalbard e Jan Mayen|47;SE|Suécia|46;CH|Suíça|41;SY|Síria|963;TW|Taiwan|886;TJ|Tajiquistão|992;TZ|Tanzânia|255;TH|Tailândia|66;TL|Timor-Leste|670;TG|Togo|228;TK|Tokelau|690;TO|Tonga|676;TT|Trindade e Tobago|1868;TN|Tunísia|216;TR|Turquia|90;TM|Turcomenistão|993;TC|Ilhas Turks e Caicos|1649;TV|Tuvalu|688;UG|Uganda|256;UA|Ucrânia|380;AE|Emirados Árabes Unidos|971;GB|Reino Unido|44;US|Estados Unidos|1;UM|Ilhas Menores Distantes dos Estados Unidos|1;UY|Uruguai|598;UZ|Uzbequistão|998;VU|Vanuatu|678;VE|Venezuela|58;VN|Vietnã|84;VG|Ilhas Virgens Britânicas|1284;VI|Ilhas Virgens Americanas|1340;WF|Wallis e Futuna|681;EH|Saara Ocidental|212;YE|Iêmen|967;ZM|Zâmbia|260;ZW|Zimbábue|263`;

export const PHONE_COUNTRIES: PhoneCountry[] = COUNTRY_DATA.split(';').map(entry => {
  const [iso, name, callingCode] = entry.split('|');
  return { iso, name, callingCode };
}).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES.find(country => country.iso === 'BR') || PHONE_COUNTRIES[0];

export function phoneCountryFlag(iso: string) {
  return iso.toUpperCase().replace(/[A-Z]/g, letter => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, '');
}

export function formatPhoneLocal(country: PhoneCountry, value: string) {
  const digits = phoneDigits(value);
  if (country.iso !== 'BR') return digits;
  const limited = digits.slice(0, 11);
  if (limited.length <= 2) return limited;
  const area = limited.slice(0, 2);
  const subscriber = limited.slice(2);
  if (subscriber.length <= 4) return `${area} ${subscriber}`;
  const splitAt = subscriber.length > 8 ? 5 : subscriber.length - 4;
  return `${area} ${subscriber.slice(0, splitAt)}-${subscriber.slice(splitAt)}`;
}

export function formatPhoneValue(country: PhoneCountry, value: string) {
  const local = formatPhoneLocal(country, value);
  return local ? `+${country.callingCode} ${local}` : '';
}

export function parsePhoneValue(value: string) {
  const normalized = value.trim();
  if (!normalized) return { country: DEFAULT_PHONE_COUNTRY, local: '' };
  if (!normalized.startsWith('+')) return { country: DEFAULT_PHONE_COUNTRY, local: formatPhoneLocal(DEFAULT_PHONE_COUNTRY, normalized) };
  const country = [...PHONE_COUNTRIES]
    .sort((left, right) => right.callingCode.length - left.callingCode.length)
    .find(candidate => normalized.replace(/\D/g, '').startsWith(candidate.callingCode));
  if (!country) return { country: DEFAULT_PHONE_COUNTRY, local: phoneDigits(normalized) };
  const digits = phoneDigits(normalized).slice(country.callingCode.length);
  return { country, local: formatPhoneLocal(country, digits) };
}
