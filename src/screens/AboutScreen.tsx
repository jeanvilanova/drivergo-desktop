import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// WhatsApp deep-link com mensagem pré-preenchida
const WA_NUMBER  = '5562982371401';
const WA_MESSAGE = 'Preciso de suporte para meu sistema DriveGO';
const WA_URL     = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MESSAGE)}`;
const SITE_URL   = 'https://drivego.app.br';

export default function AboutScreen() {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    QRCode.toDataURL(WA_URL, {
      width: 240,
      margin: 3,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl);
  }, []);

  function openExternal(url: string) {
    window.electronAPI.openExternal(url);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Hero */}
      <div className="hero">
        <div className="hero-icon-wrap" style={{ fontSize: 22 }}>
          <svg width="22" height="22" viewBox="0 0 14 14" fill="none">
            <path d="M7 1C4.2 1 2 3.2 2 6c0 .5.1 1 .3 1.4A2.5 2.5 0 0 0 2.5 12h9a2 2 0 0 0 .2-4A4 4 0 0 0 7 1z" fill="white" opacity="0.95"/>
          </svg>
        </div>
        <div>
          <div className="hero-title">Sobre o DriveGO</div>
          <div className="hero-sub">Informações do software e suporte</div>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>

        {/* App info card */}
        <div style={{
          background: 'var(--surface-2)', borderRadius: 14,
          border: '1px solid var(--border-dim)', padding: '20px 22px',
          display: 'flex', alignItems: 'center', gap: 20,
        }}>
          {/* Logo mark */}
          <div style={{
            width: 64, height: 64, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg, #1a2a3a 0%, #0d1117 100%)',
            border: '1px solid var(--border-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="34" height="34" viewBox="0 0 14 14" fill="none">
              <path d="M7 1C4.2 1 2 3.2 2 6c0 .5.1 1 .3 1.4A2.5 2.5 0 0 0 2.5 12h9a2 2 0 0 0 .2-4A4 4 0 0 0 7 1z" fill="#5caeff" opacity="0.95"/>
            </svg>
          </div>

          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.5px', lineHeight: 1 }}>
              <span style={{ color: '#fff' }}>Drive</span><span style={{ color: '#5caeff' }}>GO</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Sincronização e backup em nuvem
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', marginTop: 8,
              padding: '3px 10px', borderRadius: 10,
              background: 'rgba(92,174,255,.1)', border: '1px solid rgba(92,174,255,.2)',
              fontSize: 11, color: '#5caeff', fontWeight: 600,
            }}>
              Versão 1.0.0
            </div>
          </div>
        </div>

        {/* Company info + QR code — side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'stretch' }}>

          {/* Company info */}
          <div style={{
            background: 'var(--surface-2)', borderRadius: 14,
            border: '1px solid var(--border-dim)', padding: '20px 22px',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: '.5px' }}>
              INFORMAÇÕES DA EMPRESA
            </div>

            <InfoRow label="EMPRESA" value="SuporteGO" />
            <InfoRow label="CNPJ"    value="53.516.622/0001-33" mono />

            {/* Site link */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: '.5px', marginBottom: 5 }}>
                SITE
              </div>
              <button onClick={() => openExternal(SITE_URL)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(92,174,255,.08)', border: '1px solid rgba(92,174,255,.25)',
                borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
                color: '#5caeff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                transition: 'background .15s',
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,174,255,.16)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(92,174,255,.08)')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                drivego.app.br
              </button>
            </div>
          </div>

          {/* QR code card */}
          <div style={{
            background: 'var(--surface-2)', borderRadius: 14,
            border: '1px solid var(--border-dim)', padding: '20px 22px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            minWidth: 220,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: '.5px', alignSelf: 'flex-start' }}>
              SUPORTE VIA WHATSAPP
            </div>

            {/* QR code — fundo branco para leitura correta */}
            <div style={{
              borderRadius: 12, overflow: 'hidden',
              border: '2px solid var(--border-mid)',
              background: '#ffffff',
              padding: 6,
            }}>
              {qrDataUrl
                ? <img src={qrDataUrl} width={200} height={200} alt="QR Code WhatsApp" style={{ display: 'block', borderRadius: 6 }} />
                : <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>
                    Gerando…
                  </div>
              }
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                (62) 98237-1401
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                Escaneie para abrir o WhatsApp
              </div>
            </div>

            {/* Direct button */}
            <button onClick={() => openExternal(WA_URL)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'rgba(37,211,102,.1)', border: '1px solid rgba(37,211,102,.3)',
              borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              color: '#25D366', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              transition: 'background .15s', width: '100%', justifyContent: 'center',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(37,211,102,.18)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(37,211,102,.1)')}>
              {/* WhatsApp icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
              </svg>
              Abrir WhatsApp
            </button>
          </div>
        </div>

        {/* Footer note */}
        <div style={{
          textAlign: 'center', fontSize: 11,
          color: 'var(--text-disabled)', padding: '8px 0 4px',
        }}>
          © {new Date().getFullYear()} SuporteGO · Todos os direitos reservados
        </div>
      </div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-disabled)', letterSpacing: '.5px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, color: 'var(--text-primary)', fontWeight: 600,
        fontFamily: mono ? 'monospace' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}
