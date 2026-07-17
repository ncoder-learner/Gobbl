import { createNavigationContainerRef } from '@react-navigation/native';

// Lets code outside the component tree (the guided tour engine) drive
// navigation — e.g. jumping to the board before starting, or stepping back
// after visiting SlotViewer.
export const navigationRef = createNavigationContainerRef();
