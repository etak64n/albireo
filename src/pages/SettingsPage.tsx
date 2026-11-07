import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Cropper from "react-easy-crop";
import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, type SignIn } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { DetailList, PageHeader, Section } from "../components/Page.tsx";
import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog.tsx";
import { Input, Label, Textarea } from "../components/ui/field.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Slider } from "../components/ui/slider.tsx";
import { formatDateTime } from "../lib/format.ts";
import { cropToJpeg, type CropArea } from "../lib/image.ts";
import { usePageTitle } from "../lib/title.ts";
import { useSession } from "../session.tsx";

/** The names of the login methods of Cloudflare Access, by the type that Access reports. */
const LOGIN_METHOD_NAMES: Record<string, string> = {
  passkeys: "Passkey",
  onetimepin: "One-time PIN",
  github: "GitHub",
  google: "Google",
  "google-apps": "Google Workspace",
  azureAD: "Microsoft Entra ID",
  okta: "Okta",
  onelogin: "OneLogin",
  pingone: "PingOne",
  centrify: "Centrify",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  yandex: "Yandex",
  oidc: "OpenID Connect",
  saml: "SAML",
};

/** What happens to the picture when the person saves. */
type PictureChange = { kind: "keep" } | { kind: "replace"; image: Blob; preview: string } | { kind: "remove" };

/** The profile of the signed-in person: their picture, their display name, and their bio. */
export function SettingsPage() {
  const { me, setMe } = useSession();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [picture, setPicture] = useState<PictureChange>({ kind: "keep" });
  const [cropping, setCropping] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // How the person signed in: undefined while it loads, and null under cf dev, where Access does not run.
  const [signIn, setSignIn] = useState<SignIn | null | undefined>(undefined);
  const [signInError, setSignInError] = useState<unknown>(null);
  usePageTitle("Profile settings");

  useEffect(() => {
    let current = true;
    api.getSignIn().then(
      (response) => {
        if (current) setSignIn(response.signIn);
      },
      (err: unknown) => {
        if (current) setSignInError(err);
      },
    );
    return () => {
      current = false;
    };
  }, []);

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
      setError("Choose a picture, such as a JPEG, PNG, or WebP image.");
      return;
    }
    setError("");
    setCropping(URL.createObjectURL(file));
  }

  function closeCropper() {
    if (cropping !== null) URL.revokeObjectURL(cropping);
    setCropping(null);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      let current = me;
      if (picture.kind === "replace") {
        const signed = await api.avatarUpload();
        const response = await fetch(signed.url, {
          method: "PUT",
          headers: { "content-type": signed.contentType },
          body: picture.image,
        }).catch(() => null);
        if (response === null || !response.ok) throw new Error("The picture could not be uploaded to the storage service.");
        current = (await api.commitAvatar()).me;
      } else if (picture.kind === "remove") {
        current = (await api.removeAvatar()).me;
      }
      if (displayName.trim() !== current.displayName || bio !== current.bio) {
        current = (await api.updateMe({ displayName, bio })).me;
      }
      setMe(current);
      setPicture({ kind: "keep" });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const shown = picture.kind === "replace" ? picture.preview : picture.kind === "remove" ? null : me.avatarUrl;
  const changed = picture.kind !== "keep" || displayName.trim() !== me.displayName || bio !== me.bio;

  return (
    <Shell>
      <PageHeader title="Profile settings" />
      <div className="grid w-full max-w-[560px] gap-6">
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold text-strong">Picture</span>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar url={shown} size="huge" />
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" accept="image/*" onChange={choose} className="hidden" />
              <Button onClick={() => input.current?.click()}>Change picture</Button>
              {shown !== null && <Button onClick={() => setPicture({ kind: "remove" })}>Remove</Button>}
            </div>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={bio}
            maxLength={BIO_MAX_LENGTH}
            rows={4}
            onChange={(e) => {
              setBio(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        {error && <p className="error-box">{error}</p>}
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => void save()} disabled={saving || !changed || displayName.trim() === ""}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {saved && !changed && <span className="text-sm text-positive">Saved.</span>}
        </div>
        <Section title="Sign-in">
          <DetailList
            items={[
              { label: "Email", value: me.email },
              ...(signIn === undefined && signInError === null
                ? [
                    { label: "Login method", value: <Skeleton className="h-5 w-24" /> },
                    { label: "Signed in", value: <Skeleton className="h-5 w-36" /> },
                  ]
                : signIn
                  ? [
                      { label: "Login method", value: LOGIN_METHOD_NAMES[signIn.method] ?? signIn.method },
                      { label: "Signed in", value: formatDateTime(signIn.signedInAt) },
                    ]
                  : []),
            ]}
          />
          {signInError !== null && <p className="error-box">{signInError instanceof Error ? signInError.message : String(signInError)}</p>}
        </Section>
      </div>
      <PictureCropper
        image={cropping}
        onCancel={closeCropper}
        onCropped={(image) => {
          setPicture({ kind: "replace", image, preview: URL.createObjectURL(image) });
          setSaved(false);
          closeCropper();
        }}
        onError={(message) => {
          setError(message);
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
        <DialogTitle>Picture</DialogTitle>
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
          <Slider value={[zoom]} min={1} max={3} step={0.01} onValueChange={([value]) => setZoom(value ?? 1)} aria-label="Zoom" />
          <ZoomIn className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void apply()} disabled={area === null}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
