import React from 'react';

interface Props {
  size?: number;
  className?: string;
}

const XylonicLogo: React.FC<Props> = ({ size = 32, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="Xylonic"
    role="img"
    style={{ flexShrink: 0 }}
  >
    {/* Squircle shell — matches the surface it sits on */}
    <rect width="512" height="512" rx="115" style={{ fill: 'var(--surface)' }} />
    {/* Teal circle */}
    <circle cx="256" cy="256" r="218" fill="#006A7E" />
    {/* Eighth note — note head */}
    <ellipse
      cx="213" cy="352"
      rx="61" ry="47"
      transform="rotate(-15 213 352)"
      fill="#FFFFFF"
    />
    {/* Stem */}
    <rect x="250" y="128" width="26" height="230" rx="13" fill="#FFFFFF" />
    {/* Flag */}
    <path
      d="M 276,128 C 366,146 362,224 296,258"
      stroke="#FFFFFF"
      strokeWidth="25"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

export default XylonicLogo;
