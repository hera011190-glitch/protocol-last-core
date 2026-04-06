import { useState } from "react";
import ImageDropInput from "./ImageDropInput";

function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: 9999, padding: "12px 18px", borderRadius: "999px", background: "rgba(15,23,42,0.92)", color: "white", boxShadow: "0 12px 30px rgba(0,0,0,0.28)" }}>
      {text}
    </div>
  );
}

function CreateCharacter({ user, refresh }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [mainImage, setMainImage] = useState("");
  const [investigationImage, setInvestigationImage] = useState("");
  const [profile, setProfile] = useState("");
  const [toast, setToast] = useState("");

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2200);
  };

  const create = async () => {
    if (!name.trim()) {
      showToast("캐릭터 이름을 입력해줘.");
      return;
    }

    try {
      const res = await fetch("http://localhost:3001/createCharacter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ownerId: user.id,
          name,
          image,
          mainImage,
          investigationImage,
          profile,
        }),
      });

      if (!res.ok) {
        showToast("이미지가 너무 크거나 서버 요청에 실패했어.");
        return;
      }

      const data = await res.json();

      if (data.success) {
        showToast("캐릭터 생성 완료.");
        setName("");
        setImage("");
        setMainImage("");
        setInvestigationImage("");
        setProfile("");
        refresh?.();
      } else {
        showToast(data.message || "생성 실패");
      }
    } catch (err) {
      console.error(err);
      showToast("서버 오류");
    }
  };

  return (
    <div style={{ marginBottom: "20px", padding: "15px", background: "#1a1a1a" }}>
      <h3>캐릭터 생성</h3>

      <div style={{ marginBottom: "10px" }}>
        <input
          placeholder="캐릭터 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ display: "grid", gap: "14px", marginBottom: "12px" }}>
        <ImageDropInput label="프로필 이미지" value={image} onChange={setImage} previewHeight={150} />
        <ImageDropInput label="메인 이미지" value={mainImage} onChange={setMainImage} previewHeight={180} previewFit="contain" />
        <ImageDropInput label="조사 이미지" value={investigationImage} onChange={setInvestigationImage} previewHeight={160} previewFit="contain" />
      </div>

      <div style={{ marginBottom: "10px" }}>
        <div>프로필 글</div>
        <textarea
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          rows={6}
          style={{ width: "100%" }}
        />
      </div>

      <button onClick={create}>생성</button>
      <Toast text={toast} />
    </div>
  );
}

export default CreateCharacter;
