export const ACTIVITY_ICONS = Object.freeze([
  { id: 'home', label: 'Casa' },
  { id: 'kitchen', label: 'Cozinha' },
  { id: 'cleaning', label: 'Limpeza' },
  { id: 'broom', label: 'Vassoura' },
  { id: 'bath', label: 'Banheiro' },
  { id: 'sofa', label: 'Sala' },
  { id: 'trash', label: 'Lixo' },
  { id: 'laundry', label: 'Lavanderia' },
  { id: 'dishes', label: 'Louça' },
  { id: 'garden', label: 'Jardim' },
  { id: 'bed', label: 'Quarto' },
  { id: 'tools', label: 'Manutenção' },
]);
const allowedIcons = new Set(ACTIVITY_ICONS.map(icon => icon.id));
export const isActivityIcon = value => typeof value === 'string' && allowedIcons.has(value);
export function resolveActivityIcon(activity = {}) {
  if (isActivityIcon(activity.icon)) return activity.icon;
  const text = (String(activity.title || '') + ' ' + String(activity.area || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/lixo|residuo/.test(text)) return 'trash';
  if (/louca|pratos|talheres/.test(text)) return 'dishes';
  if (/banheiro|lavabo/.test(text)) return 'bath';
  if (/cozinha/.test(text)) return 'kitchen';
  if (/sala|sofa/.test(text)) return 'sofa';
  if (/roupa|lavanderia|area de servico/.test(text)) return 'laundry';
  if (/jardim|plantas|grama/.test(text)) return 'garden';
  if (/quarto|cama/.test(text)) return 'bed';
  if (/manutencao|consert/.test(text)) return 'tools';
  if (/varr|limp|frente|fundo|garagem|quintal/.test(text)) return 'broom';
  return 'home';
}
