'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { resolveMediaUrl } from '@/lib/media-url';
import { useAndroidBackButton } from '@/lib/use-android-back-button';

interface ProfileData {
  id: string;
  displayName: string;
  profilePath?: string;
  avatarUrl?: string | null;
  globalRole: string;
  badges?: string[];
  followersCount: number;
  followingCount: number;
  followsYou: boolean;
  isFollowing: boolean;
}

export default function PublicProfileRoutePage() {
  const router = useRouter();
  const { handle } = useParams<{ handle: string }>();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Botón nativo de retroceso Android ── */
  useAndroidBackButton(true, () => {
    router.back();
  });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api<ProfileData>(`/users/handle/${encodeURIComponent(handle)}`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar este perfil.');
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(96,249,255,.12),transparent_24%),radial-gradient(circle_at_bottom,rgba(230,90,255,.14),transparent_30%),#070b12] px-4 py-6 text-white">
      <div className="mx-auto max-w-[420px]">
        <Link href="/app" className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/78">
          Volver
        </Link>

        {error ? <div className="mt-4 rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">{error}</div> : null}
        {!error && !profile ? <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white/60">Cargando perfil...</div> : null}

        {profile ? (
          <section className="mt-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(25,31,43,.56),rgba(15,20,28,.72))] px-4 pb-5 pt-5 shadow-[0_16px_40px_rgba(0,0,0,.34)] backdrop-blur-[14px]">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-[108px] w-[108px] items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#182122] text-[28px] font-black text-white/84 shadow-[0_14px_34px_rgba(0,0,0,.34)]">
                {profile.avatarUrl ? <img src={resolveMediaUrl(profile.avatarUrl)} alt={profile.displayName} className="h-full w-full object-cover" /> : profile.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="mt-3 text-[20px] font-bold text-white">@{profile.displayName}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-white/44">{profile.globalRole}</div>
              {profile.badges?.length ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {profile.badges.map((badge) => (
                    <span key={badge} className="rounded-full border border-[#f4d58d]/20 bg-[#f4d58d]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#ffe7ad]">
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-4 text-center">
                <div className="text-[10px] uppercase tracking-[0.1em] text-white/45">Seguidores</div>
                <div className="mt-1 text-xl font-bold text-white">{profile.followersCount}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-4 text-center">
                <div className="text-[10px] uppercase tracking-[0.1em] text-white/45">Siguiendo</div>
                <div className="mt-1 text-xl font-bold text-white">{profile.followingCount}</div>
              </div>
            </div>

            <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/66">
              {profile.followsYou ? 'Este usuario también te sigue.' : 'Perfil público disponible por URL.'}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
