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
    document.getElementById("popup").style.display = "none";
}

// 건물 클릭 이벤트
function buildingInfoEvent(windowPosition, ecefPosition, cartographic, modelObject) {
    const clickPos = windowPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
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
            const currentForm = input.closest("form"); // 현재 폼
            if (pnu) {
                // 1️⃣ 건물 정보 조회
                getBuildingInfo(pnu);

                // 2️⃣ 시뮬레이터 데이터 호출
                handleSimulatorData(pnu, currentForm, lat, lon);
            } else {
                // 데이터 없을 때 초기화
                requestParam.pnu = null;
                requestParam.ldCodeNm = null;
                requestParam.mnnmSlno = null;
                requestParam.lon = null;
                requestParam.lat = null;
                requestParam.height = null;

                // 팝업 표시
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
        success: function (res) {
            try {
                const features = res.response.result.featureCollection.features;
                if (features.length > 0) {
                    const props = features[0].properties;
                    requestParam.pnu = props.pnu ?? "";
                    requestParam.ldCodeNm = props.ldCodeNm ?? "";
                    requestParam.mnnmSlno = props.mnnmSlno ?? "";  

                    $("#pnu").val(requestParam.pnu);
                    sessionStorage.setItem("pnu", props.pnu);

                    if (callback) callback(requestParam.pnu);
                } else {
                    if (callback) callback(null);
                }
            } catch (e) {
                console.error("PNU 조회 실패", e);
                if (callback) callback(null);
            }
        },
        error: function (err) {
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
        success: function (res) {
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
                sessionStorage.setItem("builtYear", String(info.useConfmDe || '').slice(0, 4));
                sessionStorage.setItem("jibunAddr", (info.ldCodeNm || '') + ' ' + (info.mnnmSlno || ''));
            } else {
                const html = `
					조회된 건물 데이터가 없습니다.
					<span id="popupClose" style="cursor:pointer; float:right; font-weight:bold;">X</span>
				`;
                showPopup(html, lastClickPosition);
                document.getElementById("popupClose").addEventListener("click", hidePopup);
            }
        },
        error: function (err) {
            console.error("건물정보 API 호출 실패:", err);
        }
    });
}

// 주소 검색 및 지도 이동
document.addEventListener("DOMContentLoaded", () => {
    const searchBoxes = document.querySelectorAll(".searchBox");

    searchBoxes.forEach((input) => {
        const resultList = input.parentElement.querySelector(".searchResult");

        input.addEventListener("keyup", async () => {
            const keyword = input.value.trim();
            if (keyword.length < 2) {
                resultList.innerHTML = "";
                resultList.classList.remove("show");
                return;
            }

            const resp = await fetch(`/GreenFinder/search?keyword=${encodeURIComponent(keyword)}`);
            if (!resp.ok) {
                console.error("검색 API 실패", resp.status);
                return;
            }

            const list = await resp.json();
            //console.log("검색 결과 JSON 확인:", list); 

            // 도로명 / 지번 분리
            const roadList = list.filter(addr => addr.roadAddr);
            const jibunList = list.filter(addr => addr.jibunAddr);

            resultList.innerHTML = "";

            // 도로명 섹션
            if (roadList.length > 0) {
                const title = document.createElement("div");
                title.className = "addr-section-title";
                title.textContent = "도로명 주소";
                resultList.appendChild(title);

                roadList.forEach(addr => {
                    const item = createAddressItem(addr, input, resultList);
                    resultList.appendChild(item);
                });
            }

            // 지번 섹션
            if (jibunList.length > 0) {
                const title = document.createElement("div");
                title.className = "addr-section-title";
                title.textContent = "지번 주소";
                resultList.appendChild(title);

                jibunList.forEach(addr => {
                    const item = createAddressItem(addr, input, resultList, true);
                    resultList.appendChild(item);
                });
            }

            if (list.length > 0) {
                resultList.classList.add("show");
            } else {
                resultList.classList.remove("show");
            }
        });
    });
});

// 주소 항목 생성 함수
function createAddressItem(addr, input, resultList, isJibun = false) {
    const item = document.createElement("div");
    item.classList.add("dropdown-item");

    const left = document.createElement("div");
    left.className = "addr-left";

    const road = document.createElement("div");
    road.className = "addr-road";
    road.textContent = isJibun ? addr.jibunAddr : addr.roadAddr;

    const jibun = document.createElement("div");
    jibun.className = "addr-jibun";
    jibun.textContent = isJibun ? addr.roadAddr : addr.jibunAddr;

    left.appendChild(road);
    left.appendChild(jibun);

    const zip = document.createElement("div");
    zip.className = "addr-zip";
    zip.textContent = addr.zipNo || "";

    item.appendChild(left);
    item.appendChild(zip);

    item.addEventListener("click", () => {
        const selectedAddr = isJibun ? addr.jibunAddr : addr.roadAddr;
        input.value = selectedAddr;
        resultList.innerHTML = "";
        resultList.classList.remove("show");

        $.ajax({
            url: "http://api.vworld.kr/req/address",
            type: "GET",
            dataType: "jsonp",
            data: {
                service: "address",
                request: "getcoord",
                version: "2.0",
                crs: "epsg:4326",
                address: selectedAddr,
                format: "json",
                type: isJibun ? "parcel" : "road",
                key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69"
            },
            success: function (data) {
                if (data && data.response?.result?.point) {
                    const lon = data.response.result.point.x;
                    const lat = data.response.result.point.y;
                    const currentForm = input.closest("form");
                    $(currentForm).find("input[name='lon']").val(lon);
                    $(currentForm).find("input[name='lat']").val(lat);
                    console.log("선택된 주소:", selectedAddr, "→ 좌표:", lat, lon);
                    // 지도 이동
                    vwmoveTo(lon, lat, 1000);

                    // 새 마커 생성
                    const marker = new vw.geom.Point(new vw.Coord(lon, lat));
                    marker.setImage("https://map.vworld.kr/images/op02/map_point.png");
                    marker.setName(selectedAddr);
                    marker.setFont("고딕");
                    marker.setFontSize(16);
                    marker.setDistanceFromTerrain(10);
                    marker.create();
                    window.selectedMarker = marker;

                    setTimeout(() => {
                        const lon = parseFloat(data.response.result.point.x);
                        const lat = parseFloat(data.response.result.point.y);
                        const html = `
                            조회된 건물 데이터가 없습니다.
                            <span id="popupClose" style="cursor:pointer; float:right; font-weight:bold;">X</span>
                        `;
                        showPopup(html, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
                        document.getElementById("popupClose").addEventListener("click", hidePopup);
                                }, 2000); // 이동 시간에 맞춰 조정

                }
            },
            error: err => console.error("지오코딩 실패:", err)
        });
    });

    return item;
}

function vwmoveTo(x, y, z) {
    var movePo = new vw.CoordZ(x, y, z);
    var mPosi = new vw.CameraPosition(movePo, new vw.Direction(0, -80, 0));
    map.moveTo(mPosi);
}

// 건물 상세 팝업
function showBuildingPopup(info, windowPosition) {
    const popup = document.getElementById("popup");

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

    popup.style.left = (windowPosition.x + 10) + "px";
    popup.style.top = (windowPosition.y - 10) + "px";
    popup.style.display = "block";
}


function fetchBuildingData(callback) {
    // 현재 form에서 lon, lat 가져오기
    const lon = parseFloat($("#lon").val());
    const lat = parseFloat($("#lat").val());

    if (!lon || !lat) return;

    // PNU 조회
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
        success: function (res) {
            try {
                const features = res.response.result.featureCollection.features;
                if (features.length > 0) {
                    const pnu = features[0].properties.pnu;
                    if (callback) callback(pnu);
                } else {
                    if (callback) callback(null);
                }
            } catch (e) {
                console.error("PNU 조회 실패", e);
                if (callback) callback(null);
            }
        },
        error: function (err) {
            console.error("PNU API 호출 오류:", err);
            if (callback) callback(null);
        }
    });
}

//좌표계 변환
function wgs84ToUtmk(lon, lat) {
    const RE = 6371.00877; // 지구 반경(km)
    const GRID = 5.0; // 격자 간격(km)
    const SLAT1 = 30.0;
    const SLAT2 = 60.0;
    const OLON = 126.0;
    const OLAT = 38.0;
    const XO = 43;
    const YO = 136;

    const DEGRAD = Math.PI / 180.0;
    const re = RE / GRID;
    const slat1 = SLAT1 * DEGRAD;
    const slat2 = SLAT2 * DEGRAD;
    const olon = OLON * DEGRAD;
    const olat = OLAT * DEGRAD;

    let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
    let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = re * sf / Math.pow(ro, sn);

    let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
    ra = re * sf / Math.pow(ra, sn);
    let theta = lon * DEGRAD - olon;
    if (theta > Math.PI) theta -= 2.0 * Math.PI;
    if (theta < -Math.PI) theta += 2.0 * Math.PI;
    theta *= sn;

    const x = ra * Math.sin(theta) + XO;
    const y = ro - ra * Math.cos(theta) + YO;

    return { x, y };
}