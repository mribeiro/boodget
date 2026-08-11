import { useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faTrash } from '@fortawesome/free-solid-svg-icons';
import { AuthContext } from '../App';
import { api } from '../services/api';
import { resizeAvatarToDataUrl, AVATAR_ACCEPTED_TYPES } from '../utils/image';
import { getInitials } from '../utils/user';
import ConfirmModal from './ConfirmModal';

export default function AvatarUpload() {
  const navigate = useNavigate();
  const { user, setAuthState } = useContext(AuthContext);
  const fileInputRef = useRef(null);

  const [pendingImage, setPendingImage] = useState(null); // resized data URL, not yet saved
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError('');
    setSuccess('');
    try {
      const dataUrl = await resizeAvatarToDataUrl(file);
      setPendingImage(dataUrl);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSave() {
    if (!pendingImage) return;
    setSaving(true);
    setError('');
    try {
      await api.uploadAvatar(pendingImage);
      setAuthState((s) => ({ ...s, user: { ...s.user, avatar: pendingImage } }));
      setPendingImage(null);
      setSuccess('Profile picture updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    setConfirmState({
      title: 'Remove profile picture',
      message: 'Remove your profile picture? You can upload a new one at any time.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        setError('');
        setSuccess('');
        try {
          await api.deleteAvatar();
          setAuthState((s) => ({ ...s, user: { ...s.user, avatar: null } }));
          setSuccess('Profile picture removed');
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  const displayImage = pendingImage || user?.avatar;

  return (
    <div>
      <div className="page-header">
        <button className="btn-ghost" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <h1>Profile Picture</h1>
      </div>

      <div style={{ maxWidth: 440 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <button
            type="button"
            className="avatar-upload-preview"
            onClick={() => fileInputRef.current?.click()}
            title="Choose a photo"
          >
            {displayImage ? (
              <img src={displayImage} alt="" className="avatar-upload-preview-img" />
            ) : (
              <span className="avatar-upload-preview-initials">{getInitials(user?.username)}</span>
            )}
            <span className="avatar-upload-preview-overlay">
              <FontAwesomeIcon icon={faCamera} />
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPTED_TYPES.join(',')}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          <button type="button" className="btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
            Choose photo
          </button>

          <div className="form-actions" style={{ width: '100%', justifyContent: 'center' }}>
            {pendingImage && (
              <button type="button" className="btn-secondary" onClick={() => setPendingImage(null)} disabled={saving}>
                Cancel
              </button>
            )}
            {pendingImage ? (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save picture'}
              </button>
            ) : (
              user?.avatar && (
                <button type="button" className="btn-ghost" style={{ color: 'var(--color-danger)' }} onClick={handleRemove}>
                  <FontAwesomeIcon icon={faTrash} style={{ marginRight: '0.4rem' }} />
                  Remove picture
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {confirmState && <ConfirmModal {...confirmState} onCancel={() => setConfirmState(null)} />}
    </div>
  );
}
