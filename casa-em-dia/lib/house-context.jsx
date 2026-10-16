'use client';
import { createContext, useContext } from 'react';
export const HouseContext = createContext(null);
export const useHouse = () => useContext(HouseContext);
