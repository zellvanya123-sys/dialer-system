const countryTimezoneMap: Record<string, string> = {
  RU: 'Europe/Moscow',
  UA: 'Europe/Kiev',
  BY: 'Europe/Minsk',
  KZ: 'Asia/Almaty',
  UZ: 'Asia/Tashkent',
  AZ: 'Asia/Baku',
  AM: 'Asia/Yerevan',
  GE: 'Asia/Tbilisi',
  TJ: 'Asia/Dushanbe',
  KG: 'Asia/Bishkek',
  TM: 'Asia/Ashgabat',
  LV: 'Europe/Riga',
  LT: 'Europe/Vilnius',
  EE: 'Europe/Tallinn',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  DE: 'Europe/Berlin',
  UK: 'Europe/London',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  US: 'America/New_York',
  CA: 'America/Toronto',
};

const phonePrefixMap: Record<string, string> = {
  '+7': 'RU',
  '8': 'RU',
  '+380': 'UA',
  '+375': 'BY',
  '+7': 'RU',
  '+77': 'KZ',
  '+998': 'UZ',
  '+994': 'AZ',
  '+374': 'AM',
  '+995': 'GE',
  '+992': 'TJ',
  '+996': 'KG',
  '+993': 'TM',
};

export function resolveTimezone(phone: string, country?: string): string {
  if (country && countryTimezoneMap[country.toUpperCase()]) {
    return countryTimezoneMap[country.toUpperCase()];
  }

  const cleanPhone = phone.replace(/\D/g, '');
  
  for (const [prefix, countryCode] of Object.entries(phonePrefixMap)) {
    const prefixClean = prefix.replace('+', '');
    if (cleanPhone.startsWith(prefixClean)) {
      if (countryTimezoneMap[countryCode]) {
        return countryTimezoneMap[countryCode];
      }
    }
  }

  if (cleanPhone.startsWith('7') || cleanPhone.startsWith('8')) {
    return 'Europe/Moscow';
  }

  return 'Europe/Moscow';
}

export function resolveCountry(phone: string): string | undefined {
  const cleanPhone = phone.replace(/\D/g, '');

  if (cleanPhone.startsWith('7')) return 'RU';
  if (cleanPhone.startsWith('380')) return 'UA';
  if (cleanPhone.startsWith('375')) return 'BY';
  if (cleanPhone.startsWith('77')) return 'KZ';
  if (cleanPhone.startsWith('998')) return 'UZ';
  if (cleanPhone.startsWith('994')) return 'AZ';
  if (cleanPhone.startsWith('374')) return 'AM';
  if (cleanPhone.startsWith('995')) return 'GE';

  return 'RU';
}

export function formatPhoneForCall(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  
  if (clean.startsWith('8') && clean.length === 11) {
    return '+7' + clean.substring(1);
  }
  
  if (!phone.startsWith('+')) {
    return '+' + clean;
  }
  
  return phone;
}