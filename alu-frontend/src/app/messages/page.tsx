'use client';

import { useEffect } from 'react';
import MessagesTab from '../components/tabs/MessagesTab';
import { initDb } from '../db';

export default function MessagesPage() {
  useEffect(() => {
    initDb().catch(() => {});
  }, []);

  return <MessagesTab />;
}
