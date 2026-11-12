/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 * Adapted from @docusaurus/theme-classic; see LICENSE in this directory (MIT).
 * Preserve the standard code-block layout while guarding detached DOM refs.
 */
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useThemeConfig } from '@docusaurus/theme-common';
import { CodeBlockContextProvider, createCodeBlockMetadata } from '@docusaurus/theme-common/internal';
import type { Props } from '@theme/CodeBlock/Content/String';
import CodeBlockLayout from '@theme/CodeBlock/Layout';

function useSafeCodeWordWrap() {
  const codeBlockRef = useRef<HTMLPreElement>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isCodeScrollable, setIsCodeScrollable] = useState(false);

  const measure = useCallback(() => {
    const block = codeBlockRef.current;
    const code = block?.querySelector('code');
    // A resize or observer callback can arrive between ref detachment and
    // passive-effect cleanup while navigating or changing responsive layout.
    if (!block || !code) return;
    setIsCodeScrollable(block.scrollWidth > block.clientWidth || code.style.whiteSpace === 'pre-wrap');
  }, []);

  const toggle = useCallback(() => {
    const code = codeBlockRef.current?.querySelector('code');
    if (!code) return;
    const enabled = !isEnabled;
    code.style.whiteSpace = enabled ? 'pre-wrap' : '';
    code.style.overflowWrap = enabled ? 'anywhere' : '';
    setIsEnabled(enabled);
  }, [isEnabled]);

  useEffect(() => {
    measure();
    const block = codeBlockRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (block) observer?.observe(block);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  useEffect(measure, [measure, isEnabled]);
  return { codeBlockRef, isEnabled, isCodeScrollable, toggle };
}

export default function CodeBlockString(props: Props): ReactNode {
  const { prism } = useThemeConfig();
  const metadata = createCodeBlockMetadata({
    code: props.children,
    className: props.className,
    metastring: props.metastring,
    magicComments: prism.magicComments,
    defaultLanguage: prism.defaultLanguage,
    language: props.language,
    title: props.title,
    showLineNumbers: props.showLineNumbers,
  });
  const wordWrap = useSafeCodeWordWrap();
  return <CodeBlockContextProvider metadata={metadata} wordWrap={wordWrap}><CodeBlockLayout /></CodeBlockContextProvider>;
}
