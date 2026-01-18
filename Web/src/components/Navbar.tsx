'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Calendar, LayoutDashboard, FileText } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/subscribers', label: 'Clients', icon: Users },
    { href: '/schedules', label: 'Schedules', icon: Calendar },
    { href: '/transaction-logs', label: 'API Logs', icon: FileText },
  ];

  return (
    <nav className="nav">
      <div className="nav-container">
        <Link href="/" className="nav-brand">
          {process.env.NEXT_PUBLIC_APP_NAME || 'APAR Client Manager'}
        </Link>

        <div className="nav-links">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={16} style={{ marginRight: '0.5rem', display: 'inline' }} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
