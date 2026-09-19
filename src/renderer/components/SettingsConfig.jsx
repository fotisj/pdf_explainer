import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setOpenrouterSettings, setModelCapabilities } from '../../state/slices/userSlice';

const MODEL_PRESETS = [
  'anthropic/claude-sonnet-4.5',
  'z-ai/glm-5.3-flash',
  'openai/gpt-5',
  'google/gemini-2.5-pro',
];

const Badge = ({ ok, label }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 8px',
      borderRadius: '999px',
      fontSize: '0.72rem',
      fontWeight: 600,
      background: ok ? 'rgba(34, 197, 94, 0.18)' : 'rgba(239, 68, 68, 0.18)',
      color: ok ? '#22c55e' : '#ef4444',
    }}
  >
    {ok ? '✓' : '✗'} {label}
  </span>
);

const SettingsConfig = () => {
  const dispatch = useDispatch();
  const { openrouterApiKey, openrouterModel } = useSelector((state) => state.user.preferences);
  const capabilities = useSelector((state) => state.user.modelCapabilities);
  const [showModal, setShowModal] = useState(false);
  const [tempModel, setTempModel] = useState('');
  const [tempCapabilities, setTempCapabilities] = useState(null); // capability info for tempModel while editing
  const [recentModels, setRecentModels] = useState([]); // model ids previously saved, most recent first
  const [catalogModels, setCatalogModels] = useState([]); // full OpenRouter model list, fetched lazily
  const debounceRef = useRef(null);

  const checkCapabilities = async (modelId) => {
    if (!modelId || !window.electron?.getModelInfo) {
      setTempCapabilities(null);
      return;
    }
    try {
      const info = await window.electron.getModelInfo(modelId);
      setTempCapabilities(info);
    } catch (error) {
      console.error('Error checking model capabilities:', error);
      setTempCapabilities(null);
    }
  };

  // Load persisted settings once on mount, and check the saved model's capabilities.
  useEffect(() => {
    const load = async () => {
      try {
        if (window.electron?.getSettings) {
          const settings = await window.electron.getSettings();
          dispatch(setOpenrouterSettings({ apiKey: settings.apiKey, model: settings.model }));
          setRecentModels(Array.isArray(settings.recentModels) ? settings.recentModels : []);
          if (settings.model && window.electron?.getModelInfo) {
            const info = await window.electron.getModelInfo(settings.model);
            dispatch(setModelCapabilities(info));
          }
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    load();
  }, [dispatch]);

  useEffect(() => {
    if (!showModal) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkCapabilities(tempModel.trim()), 400);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempModel, showModal]);

  // Fetch the full OpenRouter catalog once, the first time the modal is opened, so the model
  // field can suggest real model ids instead of just the 4 hardcoded presets.
  useEffect(() => {
    if (!showModal || catalogModels.length > 0 || !window.electron?.getModels) return;
    window.electron.getModels()
      .then((models) => setCatalogModels(Array.isArray(models) ? models : []))
      .catch((error) => console.error('Error fetching OpenRouter model catalog:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]);

  const handleSave = async () => {
    try {
      const model = tempModel.trim() || MODEL_PRESETS[0];
      dispatch(setOpenrouterSettings({ apiKey: openrouterApiKey, model }));
      if (window.electron?.setSettings) {
        await window.electron.setSettings({ model });
      }
      const info = await window.electron.getModelInfo(model).catch(() => null);
      dispatch(setModelCapabilities(info));
      setRecentModels((prev) => [model, ...prev.filter((m) => m !== model)].slice(0, 8));
      setShowModal(false);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleCancel = () => setShowModal(false);

  const handleOpenModal = () => {
    setTempModel(openrouterModel || MODEL_PRESETS[0]);
    setTempCapabilities(null);
    setShowModal(true);
  };

  const hasApiKey = !!openrouterApiKey;

  return (
    <>
      <button
        onClick={handleOpenModal}
        style={{
          background: hasApiKey ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
          color: hasApiKey ? '#22c55e' : '#ef4444',
          border: `1px solid ${hasApiKey ? '#22c55e' : '#ef4444'}`,
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '0.85rem',
          fontWeight: '500',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        {hasApiKey ? `Model: ${openrouterModel || MODEL_PRESETS[0]}` : 'Set up OpenRouter'}
        {hasApiKey && capabilities.checked && capabilities.found && (
          <span style={{ display: 'flex', gap: '4px' }}>
            <Badge ok={!!capabilities.supportsImages} label="vision" />
            <Badge ok={!!capabilities.supportsCaching} label="cache" />
          </span>
        )}
      </button>

      {showModal && (
        <>
          <div onClick={handleCancel} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div
            style={{
              position: 'fixed',
              top: '120px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(135deg, #1f2937, #374151)',
              borderRadius: '12px',
              padding: '24px',
              width: '90%',
              maxWidth: '520px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
            }}
          >
            <h3 style={{ color: 'white', marginTop: 0, marginBottom: '16px', fontSize: '1.2rem', fontWeight: '600' }}>
              OpenRouter Settings
            </h3>

            <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: '1.5' }}>
              The OpenRouter API key is read from the <code>OPENROUTER_API_KEY</code> value in this
              project's <code>.env</code> file (restart the app after changing it). Get a key from{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>
                openrouter.ai/keys
              </a>
              . {hasApiKey ? 'A key is currently loaded.' : 'No key is currently set in .env.'}
            </p>

            <label style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
              Model (start typing to search the{' '}
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>
                OpenRouter catalog
              </a>
              , or pick any slug)
            </label>

            {recentModels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {recentModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTempModel(m)}
                    style={{
                      background: m === tempModel.trim() ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255, 255, 255, 0.08)',
                      color: 'white',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <input
              list="model-presets"
              value={tempModel}
              onChange={(e) => setTempModel(e.target.value)}
              placeholder={MODEL_PRESETS[0]}
              style={{
                width: '100%',
                padding: '12px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                color: 'white',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '10px',
              }}
            />
            <datalist id="model-presets">
              {recentModels.map((m) => (
                <option key={`recent-${m}`} value={m} />
              ))}
              {MODEL_PRESETS.map((m) => (
                <option key={`preset-${m}`} value={m} />
              ))}
              {catalogModels.map((m) => (
                <option key={m.id} value={m.id} label={m.name && m.name !== m.id ? m.name : undefined} />
              ))}
            </datalist>

            <div style={{ minHeight: '26px', marginBottom: '14px' }}>
              {tempCapabilities === null ? (
                <span style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.78rem' }}>
                  {tempModel.trim() ? 'Checking model capabilities…' : ''}
                </span>
              ) : tempCapabilities ? (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Badge ok={!!tempCapabilities.supportsImages} label="handles images (equations/figures)" />
                  <Badge ok={!!tempCapabilities.supportsCaching} label="supports prompt caching" />
                </div>
              ) : (
                <span style={{ color: '#f59e0b', fontSize: '0.78rem' }}>
                  Unknown model — couldn't verify image or caching support. Double-check the slug on openrouter.ai/models.
                </span>
              )}
            </div>

            <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.75rem', marginTop: '-6px', marginBottom: '20px' }}>
              This app always sends the whole paper as context so explanations understand references to
              earlier sections — pick a model with both badges checked to keep that affordable across a
              reading session. Without caching, every explanation and follow-up re-bills the full paper.
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancel}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default SettingsConfig;
