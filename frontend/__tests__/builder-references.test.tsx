/**
 * builder-images (1) — 참고 사진 in the Builder's request box.
 *
 * Pick or paste a picture → it uploads and shows as a small thumbnail;
 * ✕ takes it out; at most three; every change asks for a fresh estimate.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = {
  listReferences: vi.fn(),
  uploadReference: vi.fn(),
  deleteReference: vi.fn(),
};
vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    listReferences: (...args: unknown[]) => api.listReferences(...args),
    uploadReference: (...args: unknown[]) => api.uploadReference(...args),
    deleteReference: (...args: unknown[]) => api.deleteReference(...args),
  };
});

const { default: ReferencePicker, imageFiles } = await import("@/app/builder/[projectId]/ReferencePicker");
type Handle = import("@/app/builder/[projectId]/ReferencePicker").ReferencePickerHandle;

const row = (id: number) => ({ id, original_name: `ref${id}.png`, media_type: "image/png", width: 1024, height: 683, stored_size: 1000, tokens: 1400 });
const png = (name = "a.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

describe("ReferencePicker", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.listReferences.mockResolvedValue([]);
    api.deleteReference.mockResolvedValue(undefined);
  });

  test("pasted pictures upload, show as thumbnails, ✕ removes, the estimate is refreshed each time", async () => {
    const onChange = vi.fn();
    const ref = createRef<Handle>();
    api.uploadReference.mockResolvedValueOnce(row(1));
    render(<ReferencePicker ref={ref} projectId={7} disabled={false} onChange={onChange} />);
    await waitFor(() => expect(api.listReferences).toHaveBeenCalledWith(7));

    let took = false;
    await act(async () => {
      took = ref.current!.addFiles([png()]);
    });
    expect(took).toBe(true);
    expect(api.uploadReference).toHaveBeenCalledWith(7, expect.any(File), "a.png");
    const thumb = await screen.findByRole("img", { name: "ref1.png" });
    expect(thumb.getAttribute("src")).toContain("/api/builder/projects/7/references/1/file");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/예상 비용에 포함/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ref1.png 빼기" }));
    await waitFor(() => expect(api.deleteReference).toHaveBeenCalledWith(7, 1));
    await waitFor(() => expect(screen.queryByRole("img", { name: "ref1.png" })).toBeNull());
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("at most three; text pastes are left to the text box", async () => {
    api.listReferences.mockResolvedValue([row(1), row(2), row(3)]);
    const ref = createRef<Handle>();
    render(<ReferencePicker ref={ref} projectId={7} disabled={false} />);
    await screen.findByRole("img", { name: "ref3.png" });
    expect((screen.getByRole("button", { name: /참고 사진/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      ref.current!.addFiles([png()]);
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.uploadReference).not.toHaveBeenCalled();
    // Only image files count; a text paste gives none.
    expect(imageFiles([new File(["x"], "a.txt", { type: "text/plain" })] as unknown as FileList)).toEqual([]);
    expect(ref.current!.addFiles([])).toBe(false);
  });

  test("a refused upload shows the server's sentence", async () => {
    const { ApiError } = await import("@/lib/api");
    api.uploadReference.mockRejectedValueOnce(new ApiError("PNG, JPG, WebP, GIF 사진만 올릴 수 있어요.", 400));
    const ref = createRef<Handle>();
    render(<ReferencePicker ref={ref} projectId={7} disabled={false} />);
    await waitFor(() => expect(api.listReferences).toHaveBeenCalled());
    await act(async () => {
      ref.current!.addFiles([png("x.png")]);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("사진만");
  });
});
