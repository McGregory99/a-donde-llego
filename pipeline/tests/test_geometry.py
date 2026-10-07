"""R2.4: line geometry from shapes.txt, else OSM, else straight stop segments."""

from test_graph import HOUR, TODAY, at, make_city, make_feed, six_an_hour

from adl.geometry import line_geometry
from adl.graph import build_graph


def feed_and_graph(shapes=None):
    stops = {"A": at(0), "B": at(1500), "C": at(3000)}
    trips = six_an_hour("L", "A", "B", 4)
    feed = make_feed(stops, {"L": "3"}, trips)
    if shapes:
        feed["shapes.txt"] = shapes
        for trip in feed["trips.txt"]:
            trip["shape_id"] = "SH1"
    return feed, build_graph(feed, make_city(HOUR), today=TODAY)


def shape_rows(points):
    return [
        {"shape_id": "SH1", "shape_pt_lat": str(lat), "shape_pt_lon": str(lon), "shape_pt_sequence": str(n)}
        for n, (lat, lon) in enumerate(points, 1)
    ]


def test_shapes_txt_wins_and_is_ordered_by_sequence():
    pts = [at(0), at(500, 40), at(1000, 40), at(1500)]
    rows = shape_rows(pts)
    rows.reverse()  # file order must not matter
    feed, graph = feed_and_graph(rows)
    lines, warnings = line_geometry(feed, graph, min_distance_m=1)
    (line,) = lines
    assert (line["id"], line["mode"], line["source"]) == ("L:0", "road", "shapes")
    assert line["points"] == [[round(lat, 5), round(lon, 5)] for lat, lon in pts]
    assert warnings == []


def test_close_points_are_simplified_but_ends_are_kept():
    pts = [at(i * 5) for i in range(0, 301)]  # 1500 m at 5 m spacing
    feed, graph = feed_and_graph(shape_rows(pts))
    (line,), _ = line_geometry(feed, graph, min_distance_m=50)
    assert 25 <= len(line["points"]) <= 40
    assert line["points"][0] == [round(pts[0][0], 5), round(pts[0][1], 5)]
    assert line["points"][-1] == [round(pts[-1][0], 5), round(pts[-1][1], 5)]


def test_osm_geometry_is_used_when_the_feed_has_no_shapes():
    feed, graph = feed_and_graph()
    osm = {"L": [at(0), at(700, 30), at(1500)]}
    (line,), warnings = line_geometry(feed, graph, osm_shapes=osm, min_distance_m=1)
    assert line["source"] == "osm"
    assert len(line["points"]) == 3
    assert warnings == []


def test_straight_stop_segments_with_a_warning_as_last_resort():
    feed, graph = feed_and_graph()
    (line,), warnings = line_geometry(feed, graph, min_distance_m=1)
    assert line["source"] == "stops"
    assert [p for p in line["points"]] == [[round(c, 5) for c in at(0)], [round(c, 5) for c in at(1500)]]
    assert len(warnings) == 1 and "L:0" in warnings[0]


def test_geometry_is_deterministic():
    feed, graph = feed_and_graph(shape_rows([at(0), at(1500)]))
    assert line_geometry(feed, graph) == line_geometry(feed, graph)


def test_only_trips_active_on_the_reference_date_choose_the_shape():
    feed, graph = feed_and_graph(shape_rows([at(0), at(500, 40), at(1500)]))
    # Three weekend-only trips on another shape outnumber the single weekday-pattern shape.
    feed["shapes.txt"] += [
        {"shape_id": "SAT", "shape_pt_lat": str(lat), "shape_pt_lon": str(lon), "shape_pt_sequence": str(n)}
        for n, (lat, lon) in enumerate([at(0), at(500, -300), at(1500)], 1)
    ]
    feed["calendar.txt"].append(
        {"service_id": "WE", "monday": "0", "tuesday": "0", "wednesday": "0", "thursday": "0",
         "friday": "0", "saturday": "1", "sunday": "1", "start_date": "20260101", "end_date": "20271231"}
    )
    for i in range(30):
        feed["trips.txt"].append(
            {"route_id": "L", "service_id": "WE", "trip_id": f"we{i}", "direction_id": "0", "shape_id": "SAT"}
        )
    (line,), _ = line_geometry(feed, graph, min_distance_m=1)
    assert line["points"][1] == [round(c, 5) for c in at(500, 40)]


def test_stop_pattern_fallback_ignores_trips_inactive_on_the_reference_date():
    feed, graph = feed_and_graph()
    feed["calendar.txt"].append(
        {"service_id": "WE", "monday": "0", "tuesday": "0", "wednesday": "0", "thursday": "0",
         "friday": "0", "saturday": "1", "sunday": "1", "start_date": "20260101", "end_date": "20271231"}
    )
    for i in range(30):
        tid = f"we{i}"
        feed["trips.txt"].append({"route_id": "L", "service_id": "WE", "trip_id": tid, "direction_id": "0"})
        feed["stop_times.txt"] += [
            {"trip_id": tid, "stop_id": s, "arrival_time": "08:00:00", "departure_time": "08:00:00",
             "stop_sequence": str(n)} for n, s in enumerate(["A", "C"], 1)
        ]
    (line,), _ = line_geometry(feed, graph, min_distance_m=1)
    assert line["points"] == [[round(c, 5) for c in at(0)], [round(c, 5) for c in at(1500)]]
