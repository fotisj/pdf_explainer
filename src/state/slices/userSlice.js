import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  preferences: {
    openrouterApiKey: '',
    openrouterModel: '',
    systemPromptAddition: '',
  },
  // What we know about the currently configured model, fetched from OpenRouter's model list.
  modelCapabilities: {
    checked: false,
    found: false,
    supportsImages: null,
    supportsCaching: null,
  },
};

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setOpenrouterSettings: (state, action) => {
      const { apiKey, model } = action.payload || {};
      if (typeof apiKey === 'string') state.preferences.openrouterApiKey = apiKey;
      if (typeof model === 'string') state.preferences.openrouterModel = model;
      const { systemPromptAddition } = action.payload || {};
      if (typeof systemPromptAddition === 'string') state.preferences.systemPromptAddition = systemPromptAddition;
    },
    setModelCapabilities: (state, action) => {
      const info = action.payload;
      state.modelCapabilities = {
        checked: true,
        found: !!info,
        supportsImages: info ? info.supportsImages : null,
        supportsCaching: info ? info.supportsCaching : null,
      };
    },
  },
});

export const { setOpenrouterSettings, setModelCapabilities } = userSlice.actions;

export default userSlice.reducer;
