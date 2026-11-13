import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Cropper from "react-easy-crop";
import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { PageHeader } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog.tsx";
import { Input, Label, Textarea } from "../components/ui/field.tsx";
import { Slider } from "../components/ui/slider.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { useT } from "../i18n.ts";
import { cropToJpeg, type CropArea } from "../lib/image.ts";
import { putAgainWhileBusy } from "../lib/upload.ts";
import { usePageTitle } from "../lib/title.ts";
import { useSession } from "../session.tsx";

/** What happens to the picture when the person saves. */
type PictureChange = { kind: "keep" } | { kind: "replace"; image: Blob; preview: string } | { kind: "remove" };

/** The channel of the person: their picture, their display name, and their bio. */
export function ChannelSettingsPage() {
  const { me, setMe } = useSession();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [picture, setPicture] = useState<PictureChange>({ kind: "keep" });
  const [cropping, setCropping] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  usePageTitle(t.common.channelSettings);

  // The preview is a URL of the image in memory. It is freed when the person picks another picture or leaves.
  useEffect(() => {
    if (picture.kind !== "replace") return;
    return () => URL.revokeObjectURL(picture.preview);
  }, [picture]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t.channel.notPicture);
      return;
    }
    setCropping(URL.createObjectURL(file));
  }

  function closeCropper() {
    if (cropping !== null) URL.revokeObjectURL(cropping);
    setCropping(null);
  }

  async function save() {
    setSaving(true);
    try {
      let current = me;
      if (picture.kind === "replace") {
        const target = await api.avatarUpload();
        await putAgainWhileBusy(target.url, picture.image, target.contentType, () => undefined).catch(() => {
          throw new Error(t.channel.uploadFailed);
        });
        current = (await api.commitAvatar()).me;
      } else if (picture.kind === "remove") {
        current = (await api.removeAvatar()).me;
      }
      if (displayName.trim() !== current.displayName || bio !== current.bio) {
        current = (await api.updateMe({ displayName, bio })).me;
      }
      setMe(current);
      setPicture({ kind: "keep" });
      toast.success(t.toast.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const shown = picture.kind === "replace" ? picture.preview : picture.kind === "remove" ? null : me.avatarUrl;
  const changed = picture.kind !== "keep" || displayName.trim() !== me.displayName || bio !== me.bio;

  return (
    <Shell>
      <PageHeader title={t.common.channelSettings} />
      <div className="grid w-full max-w-[560px] gap-6">
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold text-strong">{t.channel.picture}</span>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar url={shown} size="huge" />
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" accept="image/*" onChange={choose} className="hidden" />
              <Button onClick={() => input.current?.click()}>{t.channel.changePicture}</Button>
              {shown !== null && <Button onClick={() => setPicture({ kind: "remove" })}>{t.common.remove}</Button>}
            </div>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="display-name">{t.channel.displayName}</Label>
          <Input
            id="display-name"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bio">{t.channel.bio}</Label>
          <Textarea
            id="bio"
            value={bio}
            maxLength={BIO_MAX_LENGTH}
            rows={4}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => void save()} disabled={saving || !changed || displayName.trim() === ""}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </div>
      <PictureCropper
        image={cropping}
        onCancel={closeCropper}
        onCropped={(image) => {
          setPicture({ kind: "replace", image, preview: URL.createObjectURL(image) });
          closeCropper();
        }}
        onError={(message) => {
          toast.error(message);
          closeCropper();
        }}
      />
    </Shell>
  );
}

/** Lets the person drag and zoom the picture to choose the circle that becomes their picture. */
function PictureCropper({
  image,
  onCancel,
  onCropped,
  onError,
}: {
  image: string | null;
  onCancel: () => void;
  onCropped: (image: Blob) => void;
  onError: (message: string) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const t = useT();

  // Each new picture starts centered and not zoomed.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  }, [image]);

  async function apply() {
    if (image === null || area === null) return;
    try {
      onCropped(await cropToJpeg(image, area));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogTitle>{t.channel.picture}</DialogTitle>
        <div className="relative h-72 overflow-hidden rounded-md bg-overlay">
          {image !== null && (
            <Cropper
              image={image}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <div className="flex items-center gap-3 text-subdued">
          <ZoomOut className="size-4 shrink-0" aria-hidden="true" />
          <Slider value={[zoom]} min={1} max={3} step={0.01} onValueChange={([value]) => setZoom(value ?? 1)} aria-label={t.channel.zoom} />
          <ZoomIn className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={() => void apply()} disabled={area === null}>
            {t.channel.apply}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
