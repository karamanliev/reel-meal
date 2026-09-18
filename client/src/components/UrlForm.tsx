import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPTED_IMAGE_TYPES, isExactHttpUrl, validateSourceFiles } from "../lib/input";

interface Props {
  inputText: string; setInputText: (value: string) => void; sourceImages: File[]; setSourceImages: (files: File[]) => void;
  customImage: File | null; setCustomImage: (file: File | null) => void; useCustomImage: boolean; setUseCustomImage: (value: boolean) => void;
  translate: boolean; setTranslate: (value: boolean) => void; extractTranscript: boolean; setExtractTranscript: (value: boolean) => void;
  autoImport: boolean; setAutoImport: (value: boolean) => void; useCustomPrompt: boolean; setUseCustomPrompt: (value: boolean) => void;
  customPrompt: string; setCustomPrompt: (value: string) => void; customPromptMaxLength: number; onSubmit: (event: React.FormEvent) => void; hasJobs: boolean;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label data-checked={checked} className="neo-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="neo-toggle__track" aria-hidden="true"><span className="neo-toggle__thumb" /></span><span className="neo-toggle__body"><span className="neo-toggle__label">{label}</span><span className="neo-toggle__meta">{checked ? "Enabled" : "Disabled"}</span></span></label>;
}

function Preview({ file, onRemove, label }: { file: File; onRemove: () => void; label: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]); useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="relative overflow-hidden rounded-xl border-3 border-black bg-white"><img src={url} alt={label} className="h-28 w-full object-cover" /><button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="absolute right-1 top-1 rounded-md border-2 border-black bg-white px-2 py-1 text-xs font-800">Remove</button><p className="m-0 truncate px-2 py-1 text-xs font-700">{file.name}</p></div>;
}

export function UrlForm(props: Props) {
  const [expanded, setExpanded] = useState(!props.hasJobs); const [error, setError] = useState(""); const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!props.hasJobs || expanded) { const timer = setTimeout(() => textarea.current?.focus(), props.hasJobs ? 310 : 0); return () => clearTimeout(timer); } }, [props.hasJobs, expanded]);
  const detectedUrl = isExactHttpUrl(props.inputText); const hasSource = Boolean(props.inputText.trim() || props.sourceImages.length);
  const addSourceFiles = (incoming: File[]) => {
    if (!incoming.length) return; if (props.inputText.trim() && !window.confirm("Replace the current text or URL with image files?")) return;
    const combined = props.inputText.trim() ? incoming : [...props.sourceImages, ...incoming]; const validation = validateSourceFiles(combined); if (validation) { setError(validation); return; }
    props.setInputText(""); props.setSourceImages(combined); setError("");
  };
  const changeText = (value: string) => { if (value.trim() && props.sourceImages.length && !window.confirm("Replace the current image source with text or a URL?")) return; if (value.trim()) props.setSourceImages([]); props.setInputText(value); setError(value.length > 100_000 ? "Text must be 100,000 characters or fewer." : ""); };
  const chooseCustom = (file: File | null) => { if (file && (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024)) { setError("Custom image must be JPEG, PNG, WebP, or GIF and no larger than 10 MB."); return; } props.setCustomImage(file); setError(""); };
  const content = <div className="relative bg-pink px-5 py-5 sm:px-7 sm:py-7">
    <p className="neo-copy max-w-3xl font-300 text-ink">Paste one video or recipe-page URL, paste complete recipe text, or add up to 10 recipe images. Shared content is always shown here for review before submission.</p>
    <textarea ref={textarea} className="neo-textarea mt-5 min-h-32" value={props.inputText} onChange={(event) => changeText(event.target.value)} onPaste={(event) => { const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); addSourceFiles(images); } }} placeholder="Paste an exact URL or a complete recipe..." aria-label="Recipe URL or pasted text" />
    <div className="mt-4 rounded-2xl border-4 border-dashed border-black bg-white/70 p-5 text-center" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addSourceFiles([...event.dataTransfer.files]); }}>
      <p className="m-0 font-800">Drop recipe images here</p><p className="mt-1 text-sm">JPEG, PNG, WebP, or GIF. 10 files, 10 MB each, 50 MB total.</p>
      <label className="neo-btn-secondary mt-3 inline-flex cursor-pointer">Choose images<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => addSourceFiles([...(event.target.files ?? [])])} /></label>
    </div>
    {props.sourceImages.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{props.sourceImages.map((file, index) => <Preview key={`${file.name}-${file.lastModified}-${index}`} file={file} label={`source image ${index + 1}`} onRemove={() => props.setSourceImages(props.sourceImages.filter((_, item) => item !== index))} />)}</div>}
    {error && <p className="mt-3 font-700 text-[#7b1111]" role="alert">{error}</p>}
    <div className="mt-6 grid gap-3 md:grid-cols-2"><Toggle checked={props.translate} onChange={props.setTranslate} label="Translate to English" /><Toggle checked={props.useCustomPrompt} onChange={props.setUseCustomPrompt} label="Use a custom prompt" />{detectedUrl && <Toggle checked={props.extractTranscript} onChange={props.setExtractTranscript} label="Extract video transcript" />}<Toggle checked={props.autoImport} onChange={props.setAutoImport} label="Auto-import to Mealie" /><Toggle checked={props.useCustomImage} onChange={props.setUseCustomImage} label="Use a custom recipe image" /></div>
    {props.useCustomImage && <div className="mt-5 max-w-sm rounded-xl border-3 border-black bg-white/70 p-4"><p className="m-0 text-sm font-700">This image is only the final Mealie cover. It is not sent to the recipe model.</p>{props.customImage ? <div className="mt-3"><Preview file={props.customImage} label="custom recipe cover" onRemove={() => props.setCustomImage(null)} /></div> : <label className="neo-btn-secondary mt-3 inline-flex cursor-pointer">Choose cover<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseCustom(event.target.files?.[0] ?? null)} /></label>}</div>}
    {props.useCustomPrompt && <div className="mt-5 max-w-xl"><div className="flex justify-between"><p className="neo-overline !text-white">Custom parser instructions</p><span className="font-700 text-white">{props.customPrompt.length}/{props.customPromptMaxLength}</span></div><textarea className="neo-textarea mt-2 min-h-28" value={props.customPrompt} onChange={(event) => props.setCustomPrompt(event.target.value)} maxLength={props.customPromptMaxLength} placeholder="Prefer metric units, keep steps concise..." /></div>}
    <button type="submit" disabled={!hasSource || Boolean(error)} className="neo-btn mt-6 min-h-14 w-full bg-sun disabled:bg-[#ddd] sm:w-auto">{props.hasJobs ? "Add to queue" : props.autoImport ? "Import recipe" : "Generate recipe"}</button>
  </div>;
  const submit = (event: React.FormEvent) => { props.onSubmit(event); if (hasSource && !error) setExpanded(false); };
  if (!props.hasJobs) return <form className="relative z-10 w-full overflow-hidden rounded-[24px] border-4 border-black shadow-neo" onSubmit={submit}>{content}</form>;
  return <div className="relative z-10 w-full overflow-hidden rounded-[24px] border-4 border-black shadow-neo"><button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center bg-pink px-6 py-4 text-left font-display text-xl font-800">Add another recipe <span className="ml-auto">{expanded ? "−" : "+"}</span></button><form onSubmit={submit} className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}><div className="min-h-0 overflow-hidden">{content}</div></form></div>;
}
