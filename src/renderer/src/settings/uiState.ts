// Local UI state of the settings module that must survive section switches (e.g. the add-account wizard).

import { create } from 'zustand';

export const useSettingsUi = create<{ wizard: boolean }>(() => ({ wizard: false }));
