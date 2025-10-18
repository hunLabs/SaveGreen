// 초기 카메라/지도 설정
var hX = 127.425, hY = 38.196, hZ = 13487000;
var hH = 0, hT = -80, hR = 0;

var sX = 127.3821894, sY = 36.3484686, sZ = 1000;
var sH = 0, sT = -60, sR = 0;

var options = {
    mapId: "vmap",
    initPosition: new vw.CameraPosition(
        new vw.CoordZ(sX, sY, sZ),
        new vw.Direction(sH, sT, sR)
    ),
    logo: true,
    navigation: true
};

var map = new vw.Map();
map.setOption(options);
map.start();

// 클릭 이벤트 연결
setTimeout(() => {
    map.onClick.addEventListener(buildingInfoEvent);
}, 100);

// 전역 변수
var lastClickPosition = { x: 0, y: 0 };
var requestParam = {
    lon: null,
    lat: null,
    height: null,
    pnu: null,
    ldCodeNm: null,
    mnnmSlno: null
};

// DOM 조회
function $id(id) { return document.getElementById(id); }

// 건물 클릭 이벤트
function buildingInfoEvent(windowPosition, ecefPosition, cartographic, modelObject) {
    const clickPos = windowPosition || { x: window.innerWidth/2, y: window.innerHeight/2 };
    lastClickPosition = clickPos;

    let lon = null, lat = null;

    if (cartographic) {
        lon = cartographic.longitude * (180 / Math.PI);
        lat = cartographic.latitude * (180 / Math.PI);

        requestParam.lon = lon;
        requestParam.lat = lat;
        requestParam.height = cartographic.height;

        $("#lon").val(lon);
        $("#lat").val(lat);
        $("#height").val(cartographic.height);
    }

    if (modelObject?.attributes?.PNU) {
        requestParam.pnu = modelObject.attributes.PNU;
        $("#pnu").val(requestParam.pnu);
        getBuildingInfo(requestParam.pnu);
        return;
    }

    if (lon && lat) {
        getPnuFromCoord(lon, lat, (pnu) => {
            if (pnu) {
                getBuildingInfo(pnu);
            } else {
                requestParam.pnu = null;
                requestParam.ldCodeNm = null;
                requestParam.mnnmSlno = null;
                requestParam.lon = null;
                requestParam.lat = null;
                requestParam.height = null;

                // 데이터 없을 때 팝업 + X 버튼
                const html = `
                    조회된 건물 데이터가 없습니다.
                    <span id="popupClose" style="cursor:pointer; float:right; font-weight:bold;">X</span>
                `;
                showPopup(html, clickPos);
                document.getElementById("popupClose").addEventListener("click", hidePopup);
            }
        });
    } else {
        showPopup("클릭 위치 좌표를 찾을 수 없습니다.", clickPos);
    }
}

// PNU 조회
function getPnuFromCoord(lon, lat, callback) {
    $.ajax({
        type: "get",
        dataType: "jsonp",
        url: "https://api.vworld.kr/req/data",
        data: {
            service: "data",
            request: "getfeature",
            data: "lp_pa_cbnd_bubun",
            key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69",
            format: "json",
            geomFilter: `POINT(${lon} ${lat})`
        },
        success: function(res) {
            try {
                const features = res.response.result.featureCollection.features;
                if (features.length > 0) {
                    const props = features[0].properties;
                    requestParam.pnu = props.pnu ?? "";
                    requestParam.ldCodeNm = props.ldCodeNm ?? "";
                    requestParam.mnnmSlno = props.mnnmSlno ?? "";

                    $("#pnu").val(requestParam.pnu);
                    sessionStorage.setItem("pnu", props.pnu);

                    console.log("PNU/ldCodeNm/mnnmSlno 채워짐:", requestParam);

                    // callback 호출
                    if (callback) callback(requestParam.pnu);
                } else {
                    if (callback) callback(null);
                }
            } catch (e) {
                console.error("PNU 조회 실패", e);
                if (callback) callback(null);
            }
        },
        error: function(err) {
            console.error("PNU API 호출 오류:", err);
            if (callback) callback(null);
        }
    });
}

// 건물 정보 조회
function getBuildingInfo(pnu) {
    const reqData = {
        key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69",
        pnu: pnu,
        format: "json",
        numOfRows: "10"
    };

    $.ajax({
        type: "get",
        dataType: "jsonp",
        url: "http://api.vworld.kr/ned/data/getBuildingUse",
        data: reqData,
        success: function(res) {
            if (res?.buildingUses?.field?.length > 0) {
                const info = res.buildingUses.field[0];
                showBuildingPopup(info, lastClickPosition);
                requestParam.ldCodeNm = info.ldCodeNm ?? "";
                requestParam.mnnmSlno = info.mnnmSlno ?? "";
                $("#ldCodeNm").val(info.ldCodeNm);
                $("#mnnmSlno").val(info.mnnmSlno);

                sessionStorage.setItem("ldCodeNm", info.ldCodeNm);
                sessionStorage.setItem("mnnmSlno", info.mnnmSlno);
                sessionStorage.setItem("BuildingArea", info.buldBildngAr);
                sessionStorage.setItem("buildingName", info.buldNm);
                sessionStorage.setItem("useConfmDe", info.useConfmDe);
                sessionStorage.setItem("builtYear", String(info.useConfmDe||'').slice(0,4));
                sessionStorage.setItem("jibunAddr", (info.ldCodeNm||'') + ' ' + (info.mnnmSlno||''));
            } else {
                // 데이터 없을 때 팝업 + X 버튼
                const html = `
                    조회된 건물 데이터가 없습니다.
                    <span id="popupClose" style="cursor:pointer; float:right; font-weight:bold;">X</span>
                `;
                showPopup(html, lastClickPosition);
                document.getElementById("popupClose").addEventListener("click", hidePopup);
            }
        },
        error: function(err) {
            console.error("건물정보 API 호출 실패:", err);
        }
    });
}

// 일반 팝업
function showPopup(html, windowPosition) {
    const popup = document.getElementById("popup");
    const posX = windowPosition?.x ?? window.innerWidth / 2;
    const posY = windowPosition?.y ?? window.innerHeight / 2;

    popup.style.left = (posX + 10) + "px";
    popup.style.top = (posY - 10) + "px";
    popup.innerHTML = html;
    popup.style.display = "block";
}

function hidePopup() {
    $id("popup").style.display = "none";
}

// 건물 상세 팝업
function showBuildingPopup(info, windowPosition) {
    $("#buildingName").text(info.buldNm || "-");
    $("#roadAddr").text(info.roadAddr || "-");
    $("#jibunAddr").text(info.jibunAddr || "-");
    $("#engAddr").text(info.engAddr || "-");

    $("#buldNm").text(info.buldNm || "-");
    $("#buldDongNm").text(info.buldDongNm || "-");
    $("#ldCodeNm").text(info.ldCodeNm || "-");
    $("#mnnmSlno").text(info.mnnmSlno || "-");
    $("#groundFloorCo").text(info.groundFloorCo || "-");
    $("#undgrndFloorCo").text(info.undgrndFloorCo || "-");
    $("#buldBildngAr").text(info.buldBildngAr || "-");
    $("#buldPlotAr").text(info.buldPlotAr || "-");
    $("#buldHg").text(info.buldHg || "-");
    $("#buldPrposClCodeNm").text(info.buldPrposClCodeNm || "-");
    $("#mainPurpsClCodeNm").text(info.mainPurpsClCodeNm || "-");
    $("#useConfmDe").text(info.useConfmDe || "-");
    $("#detailPrposCodeNm").text(info.detailPrposCodeNm || "-");
    $("#prmisnDe").text(info.prmisnDe || "-");

    const popup = document.getElementById("popup");
    popup.style.left = (windowPosition.x + 10) + "px";
    popup.style.top = (windowPosition.y - 10) + "px";
    popup.style.display = "block";
}

// 주소 검색 및 지도 이동 부분 (생략 가능, 기존 그대로 유지)
document.addEventListener("DOMContentLoaded", () => {
  const searchBoxes = document.querySelectorAll(".searchBox");
  // ... 주소 검색 로직
});

function vwmoveTo(x, y, z) {
    var movePo = new vw.CoordZ(x, y, z);
    var mPosi = new vw.CameraPosition(movePo, new vw.Direction(0, -80, 0));
    map.moveTo(mPosi);
}
