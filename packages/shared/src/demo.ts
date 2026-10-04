/** SYNTHETIC demo content (fictional doctors and events) used by the server seed and the in-browser local mode. */

export const DEMO_SPECIALISTS = [
  { name: 'Д-р Елена Примерова (демо)', specialty: 'Ендокринолог', phone: '+359 000 000 111', email: 'elena.primerova@example.com', clinic: 'Демо медицински център', address: 'ул. Примерна 10, София', website: 'https://example.com', note: 'Синтетичен профил за демонстрация.', lastVisitAt: '2025-09-05', nextVisitAt: '2026-11-20' },
  { name: 'Д-р Петър Демонов (демо)', specialty: 'Общопрактикуващ лекар', phone: '+359 000 000 222', email: 'p.demonov@example.com', clinic: 'Демо практика', address: 'бул. Тестов 5, София', website: null, note: null, lastVisitAt: '2026-09-15', nextVisitAt: null },
  { name: 'Д-р Мария Синтетична (демо)', specialty: 'Кардиолог', phone: null, email: 'm.sintetichna@example.com', clinic: 'Демо кардиологичен кабинет', address: null, website: null, note: 'Проследява липидния профил.', lastVisitAt: '2025-11-02', nextVisitAt: null },
] as const;

export const DEMO_EVENTS = [
  { kind: 'diet_change', title: 'Нов режим на хранене', date: '2025-03-01', description: 'Бележка на потребителя (демо).' },
  { kind: 'appointment', title: 'Консултация с ендокринолог', date: '2025-09-05', description: null },
  { kind: 'exercise', title: 'Начало на спортна програма', date: '2026-03-15', description: '3 тренировки седмично (демо).' },
  { kind: 'appointment', title: 'Преглед при общопрактикуващ лекар', date: '2026-09-15', description: null },
] as const;
