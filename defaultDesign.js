const makePage = (background = {}) => ({
  width: 1400,
  height: 900,
  background: {
    color: background.color || "#eef9ff",
    image: background.image || "",
    size: background.size || "cover",
    position: background.position || "center",
    overlay:
      background.overlay ||
      "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(232,246,255,0.86))",
  },
  elements: [],
  shellElements: [],
  domOverrides: {},
  shellOverrides: {},
});

const defaultDesign = {
  theme: {
    presetName: "bright-blue-white",
    bgMain: "#eef9ff",
    bgDeep: "#dff4ff",
    bgSoft: "#f8fdff",
    panel: "rgba(255,255,255,0.78)",
    panelStrong: "rgba(255,255,255,0.92)",
    panelSoft: "rgba(226,244,255,0.70)",
    textMain: "#13324b",
    textSoft: "#4f7390",
    textFaint: "#7e9bb2",
    accent: "#55c7ff",
    accentStrong: "#1ea7ff",
    accentDeep: "#0b79d0",
    line: "rgba(98, 176, 220, 0.18)",
    lineStrong: "rgba(64, 153, 207, 0.28)",
    success: "#27c281",
    warning: "#f5ae2b",
    danger: "#ef5f7a",
    glow: "rgba(85, 199, 255, 0.24)",
    shadow: "0 24px 60px rgba(73, 132, 170, 0.16)",
    radiusXl: "30px",
    radiusLg: "24px",
    radiusMd: "18px",
    radiusSm: "14px",
    fontFamily:
      '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
    buttonPrimaryBg:
      "linear-gradient(135deg, #7fdbff 0%, #39bfff 55%, #1d9dff 100%)",
    buttonPrimaryText: "#ffffff",
    buttonGhostBg: "rgba(255,255,255,0.62)",
    buttonGhostText: "#18405f",
    inputBg: "rgba(255,255,255,0.86)",
    inputText: "#16324a",
    inputPlaceholder: "#7f9db4",
    topbarBg: "rgba(244, 252, 255, 0.82)",
  },

  sharedShellElements: [],
  sharedShellOverrides: {},

  siteContent: {
    brand: {
      title: "",
      subtitle: "",
      showTitle: false,
      showSubtitle: false,
    },

    topNav: {
      home: "홈",
      sd: "맵",
      characters: "캐릭터",
      investigations: "조사",
      shop: "상점",
      my: "MY",
    },

    home: {
      leftCard1: {
        eyebrow: "NOTICE",
        title: "공지사항",
        body: "홈에선 목록만 보이고, 클릭하면 따로 긴 페이지처럼 열리도록 구성했어.",
        buttonText: "공지사항 열기",
        detailTitle: "공지사항",
        detailBody:
          "여기는 공지사항 전용 페이지 자리야.\n\n이후에는 운영자가 길게 적은 공지 내용을 여기로 옮기면 돼.\n현재는 구조만 먼저 만들어둔 상태야.",
      },

      leftCard2: {
        eyebrow: "WORLD",
        title: "세계관",
        body: "세계관 요약을 보여주고, 클릭하면 긴 설명을 따로 열 수 있게 해둔 공간이야.",
        buttonText: "세계관 열기",
        detailTitle: "세계관",
        detailBody:
          "여기는 세계관 전용 페이지 자리야.\n\n추후 세계관 설명, 세력 설명, 용어 정리 같은 긴 내용을 넣으면 돼.",
      },

      centerLogo: {
        eyebrow: "PROTOCOL",
        title: "LAST CORE",
      },

      schedule: {
        eyebrow: "SCHEDULE",
        title: "일정표",
        items: [
          { day: "MON", title: "일일조사 오픈", time: "상시", note: "추후 실제 운영 일정과 연결" },
          { day: "WED", title: "상점 갱신", time: "20:00", note: "추후 실제 운영 일정과 연결" },
          { day: "FRI", title: "단체조사 예정", time: "21:00", note: "추후 실제 운영 일정과 연결" },
          { day: "SUN", title: "정산 / 로그 정리", time: "22:00", note: "추후 실제 운영 일정과 연결" },
        ],
      },

      quickMenu: {
        eyebrow: "QUICK MENU",
        title: "바로가기",
        sd: "맵",
        characters: "캐릭터",
        investigations: "조사",
        shop: "상점",
        my: "MY",
      },

      characterBox: {
        eyebrow: "CURRENT CHARACTER",
        title: "현재 캐릭터",
        emptyText: "아직 활성 캐릭터가 없어. MY에서 캐릭터를 선택하거나 생성해줘.",
        manageButtonText: "MY에서 관리하기",
        emptyButtonText: "캐릭터 선택 / 생성",
        levelLabel: "LEVEL",
        corrosionLabel: "CORROSION",
        coinSuffix: "COIN",
      },
    },
  },

  pages: {
    home: makePage({
      color: "#eef9ff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.58), rgba(229,245,255,0.86))",
    }),
    sd: makePage({
      color: "#e6f7ff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.30), rgba(232,246,255,0.40))",
    }),
    characters: makePage({
      color: "#f4fbff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.64), rgba(235,247,255,0.82))",
    }),
    investigations: makePage({
      color: "#edf8ff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.52), rgba(226,244,255,0.78))",
    }),
    shop: makePage({
      color: "#f2fbff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.62), rgba(232,246,255,0.84))",
    }),
    my: makePage({
      color: "#eef9ff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.62), rgba(228,245,255,0.84))",
    }),
    login: makePage({
      color: "#f3fbff",
      overlay:
        "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(230,246,255,0.88))",
    }),
  },
};

module.exports = defaultDesign;