import { configureStore } from '@reduxjs/toolkit';
import pdfReducer from './slices/pdfSlice';
import userReducer from './slices/userSlice';

export const store = configureStore({
  reducer: {
    pdf: pdfReducer,
    user: userReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
});

export default store;
