import { type TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

import { combineReducers, configureStore } from '@reduxjs/toolkit';

import canvasReducer from './canvasSlice';
import clipboardReducer from './clipboardSlice';
import derivedNodesReducer from './derivedNodesSlice';
import edgesReducer from './edgesSlice';
import filesReducer from './filesSlice';
import groupsReducer from './groupsSlice';
import { withHistory } from './history';
import projectReducer from './projectSlice';
import testEnvironmentsReducer from './testEnvironmentsSlice';

const rootReducer = withHistory(
  combineReducers({
    canvas: canvasReducer,
    clipboard: clipboardReducer,
    derivedNodes: derivedNodesReducer,
    edges: edgesReducer,
    files: filesReducer,
    groups: groupsReducer,
    project: projectReducer,
    testEnvironments: testEnvironmentsReducer
  })
);

// Factory rather than a bare instance so tests can create isolated stores
// instead of sharing (and leaking state through) the app's singleton.
export const createAppStore = () => configureStore({ reducer: rootReducer });

export const store = createAppStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
export const useAppDispatch = () => useDispatch<AppDispatch>();

export default store;
