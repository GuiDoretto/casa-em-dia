'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useHouse } from '../lib/house-context';
import { Avatar, Icon } from './ui';

const ORIGINAL_LIMIT = 8 * 1024 * 1024;
const SAVED_LIMIT = 192 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.onload = null; image.onerror = null; resolve(image); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error('Não conseguimos abrir essa imagem. Escolha outro arquivo JPEG, PNG ou WebP.')); };
    image.src = url;
  });
}
export default function ProfilePhotoEditor({ user }) {
  const { state, busy, mutate, notify } = useHouse();
  const [pending, setPending] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef(0), activeUrls = useRef(new Set()), savingRef = useRef(false);
  const uploadId = useId(), hintId = useId();
  const userId = user?.id;
  useEffect(() => {
    setPending(''); setError(''); setProcessing(false); setSaving(false);
    return () => {
      selection.current++;
      for (const url of activeUrls.current) URL.revokeObjectURL(url);
      activeUrls.current.clear();
    };
  }, [userId]);
  if (!userId || !state || (state.user.id !== userId && state.user.role !== 'admin')) return null;
  const current = state.users.find(person => person.id === userId) || (state.user.id === userId ? state.user : user);
  const disabled = busy || processing || saving;
  async function choosePhoto(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || disabled) return;
    const attempt = ++selection.current;
    setError('');
    if (!MIME_TYPES.has(file.type)) { setError('Escolha uma imagem JPEG, PNG ou WebP.'); return; }
    if (!file.size || file.size > ORIGINAL_LIMIT) { setError('Escolha uma imagem de até 8 MB.'); return; }
    setProcessing(true);
    const url = URL.createObjectURL(file);
    activeUrls.current.add(url);
    try {
      const image = await loadImage(url);
      if (attempt !== selection.current) return;
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Essa imagem não tem dimensões válidas. Escolha outra foto.');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Este navegador não conseguiu preparar a foto. Tente em outro navegador.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      const photo = canvas.toDataURL('image/jpeg', 0.85);
      const encoded = photo.split(',')[1] || '';
      const bytes = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
      if (!photo.startsWith('data:image/jpeg;base64,') || !bytes || bytes > SAVED_LIMIT) throw new Error('A foto ficou maior que o permitido. Escolha outra imagem.');
      setPending(photo);
    } catch (failure) {
      if (attempt === selection.current) setError(failure.message || 'Não foi possível preparar sua foto.');
    } finally {
      URL.revokeObjectURL(url); activeUrls.current.delete(url);
      if (attempt === selection.current) setProcessing(false);
    }
  }
  async function savePhoto(photo) {
    if (disabled || savingRef.current) return;
    const attempt = selection.current;
    savingRef.current = true; setSaving(true); setError('');
    try {
      await mutate('profile-photo', { userId, photo });
      if (attempt === selection.current) {
        setPending('');
        notify(photo === null ? 'Foto removida.' : 'Foto do perfil atualizada.');
      }
    } catch (failure) {
      if (attempt === selection.current) {
        const message = failure.message || 'Não foi possível salvar a foto. Tente novamente.';
        setError(message); notify(message);
      }
    } finally {
      savingRef.current = false;
      if (attempt === selection.current) setSaving(false);
    }
  }
  return <section className="profile-photo-editor" aria-label="Foto do perfil" aria-busy={processing || saving}><div className="photo-preview"><Avatar user={{ ...current, photo_url: pending || current.photo_url }}/></div><div className="photo-actions"><strong>Foto do perfil</strong><p className="hint" id={hintId}>{pending ? 'Confira o recorte antes de salvar. A foto ainda não foi enviada.' : 'JPEG, PNG ou WebP, até 8 MB. A imagem será recortada no centro.'}</p><div className="row wrap"><label className="btn secondary photo-upload" htmlFor={uploadId} aria-disabled={disabled}><Icon name="plus" size={15}/>{pending ? 'Escolher outra foto' : 'Escolher foto'}<input id={uploadId} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Escolher foto do perfil" aria-describedby={hintId} disabled={disabled} onChange={choosePhoto}/></label>{pending && <button type="button" className="btn" disabled={disabled} onClick={() => savePhoto(pending)}><Icon name="check" size={15}/>{saving ? 'Salvando…' : 'Salvar foto'}</button>}{pending && <button type="button" className="text-btn" disabled={disabled} onClick={() => { setPending(''); setError(''); }}>Descartar seleção</button>}{current.photo_url && <button type="button" className="text-btn" disabled={disabled} onClick={() => savePhoto(null)}><Icon name="trash" size={14}/>Remover foto</button>}</div>{processing && <p className="hint" role="status">Preparando sua foto…</p>}{error && <p className="hint" role="alert" style={{ color: '#a4473b' }}>{error}</p>}</div></section>;
}